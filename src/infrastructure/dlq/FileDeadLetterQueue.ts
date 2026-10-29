/**
 * Infrastructure: File-based Dead Letter Queue
 * Persists failed log entries to disk for later retry
 */
import { existsSync } from 'fs';
import { appendFile, mkdir, readFile, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { LogEntry } from '../../domain/entities/LogEntry';
import { IDeadLetterQueue } from '../../domain/interfaces/IDeadLetterQueue';
import { internalWarn } from '../../utils';
import { boundedSnapshot } from '../memory/BoundedSnapshot';

interface DLQEntry {
  entry: LogEntry;
  reason: string;
  timestamp: number;
  retryCount: number;
}

export interface FileDLQConfig {
  readonly basePath?: string;
  readonly maxSize?: number; // Max entries in memory
  readonly maxFileSizeMB?: number; // Max file size before rotation
  readonly maxRetries?: number; // Max retry attempts per entry
}

export class FileDeadLetterQueue implements IDeadLetterQueue {
  private queue: DLQEntry[] = [];
  private readonly filePath: string;
  private readonly maxSize: number;
  private readonly maxFileSizeMB: number;
  private readonly maxRetries: number;
  private readonly ready: Promise<void>;

  constructor(config: FileDLQConfig = {}) {
    const basePath = config.basePath || process.cwd();
    const dlqDir = join(basePath, '.logs-interceptor-dlq');

    // Ensure directory exists
    this.ready = mkdir(dlqDir, { recursive: true, mode: 0o700 }).then(() => {}, () => {});

    this.filePath = join(dlqDir, `dlq-${Date.now()}.jsonl`);
    this.maxSize = Number.isFinite(config.maxSize) ? Math.max(1, Math.min(10000, config.maxSize!)) : 1000;
    this.maxFileSizeMB = Number.isFinite(config.maxFileSizeMB) ? Math.max(0.001, Math.min(100, config.maxFileSizeMB!)) : 10;
    this.maxRetries = config.maxRetries ?? 3;
  }

  async add(entry: LogEntry, reason: string): Promise<void> {
    return this.addBatch([entry], reason);
  }

  async addBatch(entries: LogEntry[], reason: string): Promise<void> {
    if (entries.length === 0) return;

    const timestamp = Date.now();
    const batchData: string[] = [];

    for (const entry of entries.slice(-this.maxSize)) {
      const snapshot = boundedSnapshot(entry, 8, 16384);
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) continue;
      const dlqEntry: DLQEntry = {
        entry: snapshot as LogEntry,
        reason: reason.slice(0, 1024),
        timestamp,
        retryCount: 0,
      };

      // Add to memory queue
      this.queue.push(dlqEntry);
      batchData.push(JSON.stringify(dlqEntry));
    }

    // Persist to disk safely (awaiting ensures data is safe before yielding)
    await this.persistBatchToDisk(batchData);

    // Trim memory queue if needed
    if (this.queue.length > this.maxSize) {
      this.queue = this.queue.slice(this.queue.length - this.maxSize);
    }
  }

  async flush(): Promise<number> {
    // In a passive DLQ, flush doesn't automatically resend.
    // Use recover() or external scripts to reprocess DLQ files.
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
      internalWarn('File DLQ clear failed');
    }
  }

  async getEntries(limit: number = 100): Promise<Array<{ entry: LogEntry; reason: string; timestamp: number }>> {
    return this.queue
      .slice(0, limit)
      .map(({ entry, reason, timestamp }) => ({ entry, reason, timestamp }));
  }

  private async persistBatchToDisk(lines: string[]): Promise<void> {
    try {
      await this.ready;
      const content = lines.join('\n') + '\n';
      const size = existsSync(this.filePath) ? (await stat(this.filePath)).size : 0;
      if (size + Buffer.byteLength(content) > this.maxFileSizeMB * 1024 * 1024) throw new Error('Legacy DLQ file limit');
      await appendFile(this.filePath, content, { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      internalWarn('File DLQ write failed or size limit reached');
    }
  }

  /**
   * Load entries from disk (for recovery)
   */
  async loadFromDisk(): Promise<number> {
    try {
      await this.ready;
      if (!existsSync(this.filePath)) {
        return 0;
      }

      if ((await stat(this.filePath)).size > this.maxFileSizeMB * 1024 * 1024) return 0;
      const content = await readFile(this.filePath, 'utf8');
      const lines = content.trim().split('\n').filter((line: string) => line.trim());

      for (const line of lines.slice(-this.maxSize)) {
        try {
          const entry: DLQEntry = JSON.parse(line);
          this.queue.push(entry);
        } catch {
          // Skip invalid entries
        }
      }

      this.queue = this.queue.slice(-this.maxSize);
      return this.queue.length;
    } catch (error) {
      internalWarn('File DLQ recovery failed');
      return 0;
    }
  }
}
