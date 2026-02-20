/**
 * Infrastructure: File-based Dead Letter Queue
 * Persists failed log entries to disk for later retry
 */
import { existsSync } from 'fs';
import { appendFile, mkdir, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { LogEntry } from '../../domain/entities/LogEntry';
import { IDeadLetterQueue } from '../../domain/interfaces/IDeadLetterQueue';

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

  constructor(config: FileDLQConfig = {}) {
    const basePath = config.basePath || process.cwd();
    const dlqDir = join(basePath, '.logs-interceptor-dlq');

    // Ensure directory exists
    if (!existsSync(dlqDir)) {
      mkdir(dlqDir, { recursive: true }).catch(() => {
        // Ignore errors, will fail on write if needed
      });
    }

    this.filePath = join(dlqDir, `dlq-${Date.now()}.jsonl`);
    this.maxSize = config.maxSize ?? 1000;
    this.maxFileSizeMB = config.maxFileSizeMB ?? 10;
    this.maxRetries = config.maxRetries ?? 3;
  }

  async add(entry: LogEntry, reason: string): Promise<void> {
    return this.addBatch([entry], reason);
  }

  async addBatch(entries: LogEntry[], reason: string): Promise<void> {
    if (entries.length === 0) return;

    const timestamp = Date.now();
    const batchData: string[] = [];

    for (const entry of entries) {
      const dlqEntry: DLQEntry = {
        entry,
        reason,
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
      console.warn('[FileDLQ] Failed to clear file:', error);
    }
  }

  async getEntries(limit: number = 100): Promise<Array<{ entry: LogEntry; reason: string; timestamp: number }>> {
    return this.queue
      .slice(0, limit)
      .map(({ entry, reason, timestamp }) => ({ entry, reason, timestamp }));
  }

  private async persistBatchToDisk(lines: string[]): Promise<void> {
    try {
      const content = lines.join('\n') + '\n';
      await appendFile(this.filePath, content, 'utf8');
    } catch (error) {
      console.warn('[FileDLQ] Failed to write to disk:', error);
    }
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
      const lines = content.trim().split('\n').filter((line: string) => line.trim());

      for (const line of lines) {
        try {
          const entry: DLQEntry = JSON.parse(line);
          this.queue.push(entry);
        } catch {
          // Skip invalid entries
        }
      }

      return this.queue.length;
    } catch (error) {
      console.warn('[FileDLQ] Failed to load from disk:', error);
      return 0;
    }
  }
}
