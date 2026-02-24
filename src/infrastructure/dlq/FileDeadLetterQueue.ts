/**
 * Infrastructure: File-based Dead Letter Queue
 * Persists failed log entries to disk for later retry
 */
import { existsSync, mkdirSync } from 'fs';
import { readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { LogEntry } from '../../domain/entities/LogEntry';
import {
  DeadLetterQueueStats,
  DLQAddResult,
  IDeadLetterQueue,
} from '../../domain/interfaces/IDeadLetterQueue';
import { internalWarn } from '../../utils';

interface DLQEntry {
  entry: LogEntry;
  reason: string;
  timestamp: number;
  retryCount: number;
}

export interface FileDLQConfig {
  readonly basePath?: string;
  readonly maxSize?: number;
  readonly maxFileSizeMB?: number;
  readonly maxRetries?: number;
}

export class FileDeadLetterQueue implements IDeadLetterQueue {
  private queue: DLQEntry[] = [];
  private readonly filePath: string;
  private readonly maxSize: number;
  private readonly maxFileSizeMB: number;
  private readonly maxRetries: number;
  private droppedEntries = 0;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(config: FileDLQConfig = {}) {
    const basePath = config.basePath || process.cwd();
    const dlqDir = join(basePath, '.logs-interceptor-dlq');

    if (!existsSync(dlqDir)) {
      mkdirSync(dlqDir, { recursive: true });
    }

    this.filePath = join(dlqDir, 'dlq-current.jsonl');
    this.maxSize = config.maxSize ?? 1000;
    this.maxFileSizeMB = config.maxFileSizeMB ?? 10;
    this.maxRetries = config.maxRetries ?? 3;

    void this.loadFromDisk();
  }

  async add(entry: LogEntry, reason: string): Promise<DLQAddResult> {
    return this.addBatch([entry], reason);
  }

  async addBatch(entries: LogEntry[], reason: string): Promise<DLQAddResult> {
    if (entries.length === 0) {
      return { added: 0, dropped: 0 };
    }

    const timestamp = Date.now();
    let dropped = 0;

    for (const entry of entries) {
      if (this.queue.length >= this.maxSize) {
        this.queue.shift();
        this.droppedEntries++;
        dropped++;
      }

      this.queue.push({
        entry,
        reason,
        timestamp,
        retryCount: 0,
      });
    }

    this.writeChain = this.writeChain
      .then(() => this.persistQueueToDisk())
      .catch((error) => {
        internalWarn('[FileDLQ] Failed to persist queue to disk', error);
      });

    await this.writeChain;

    return {
      added: entries.length,
      dropped,
    };
  }

  async flush(): Promise<number> {
    return 0;
  }

  size(): number {
    return this.queue.length;
  }

  async clear(): Promise<void> {
    this.queue = [];
    try {
      if (existsSync(this.filePath)) {
        await unlink(this.filePath);
      }
    } catch (error) {
      internalWarn('[FileDLQ] Failed to clear file', error);
    }
  }

  async getEntries(
    limit: number = 100
  ): Promise<Array<{ entry: LogEntry; reason: string; timestamp: number }>> {
    return this.queue
      .slice(0, limit)
      .map(({ entry, reason, timestamp }) => ({ entry, reason, timestamp }));
  }

  getStats(): DeadLetterQueueStats {
    return {
      size: this.queue.length,
      droppedEntries: this.droppedEntries,
    };
  }

  /**
   * Load entries from disk (for recovery)
   */
  async loadFromDisk(): Promise<number> {
    try {
      if (!existsSync(this.filePath)) {
        return 0;
      }

      const content = await readFile(this.filePath, 'utf8');
      const lines = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const parsed: DLQEntry[] = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as DLQEntry;
          if (entry.retryCount <= this.maxRetries) {
            parsed.push(entry);
          }
        } catch {
          // ignore invalid line
        }
      }

      if (parsed.length > this.maxSize) {
        this.droppedEntries += parsed.length - this.maxSize;
      }

      this.queue = parsed.slice(Math.max(0, parsed.length - this.maxSize));
      return this.queue.length;
    } catch (error) {
      internalWarn('[FileDLQ] Failed to load from disk', error);
      return 0;
    }
  }

  private async persistQueueToDisk(): Promise<void> {
    const lines = this.queue.map((entry) => JSON.stringify(entry));
    const content = `${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`;

    const maxBytes = this.maxFileSizeMB * 1024 * 1024;
    if (Buffer.byteLength(content, 'utf8') > maxBytes && this.queue.length > 0) {
      // Keep the newest half when file budget is exceeded.
      const half = Math.max(1, Math.floor(this.queue.length / 2));
      const dropped = this.queue.length - half;
      this.queue = this.queue.slice(-half);
      this.droppedEntries += dropped;
      return this.persistQueueToDisk();
    }

    await writeFile(this.filePath, content, 'utf8');
  }
}
