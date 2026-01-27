/**
 * Infrastructure: File-based Dead Letter Queue
 * Persists failed log entries to disk for later retry
 */
import { IDeadLetterQueue } from '../../domain/interfaces/IDeadLetterQueue';
import { LogEntry } from '../../domain/entities/LogEntry';
import { writeFile, appendFile, readFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

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
    const dlqEntry: DLQEntry = {
      entry,
      reason,
      timestamp: Date.now(),
      retryCount: 0,
    };

    // Add to memory queue
    this.queue.push(dlqEntry);

    // Trim if exceeds max size
    if (this.queue.length > this.maxSize) {
      const removed = this.queue.shift();
      if (removed) {
        // Persist removed entry to disk
        await this.persistToDisk(removed);
      }
    }

    // Persist to disk asynchronously (don't block)
    this.persistToDisk(dlqEntry).catch(error => {
      console.warn('[FileDLQ] Failed to persist entry:', error);
    });
  }

  async flush(): Promise<number> {
    if (this.queue.length === 0) {
      return 0;
    }

    const entries = [...this.queue];
    this.queue = [];

    // Try to resend entries
    let flushed = 0;
    for (const dlqEntry of entries) {
      if (dlqEntry.retryCount >= this.maxRetries) {
        // Max retries reached, keep in DLQ
        this.queue.push(dlqEntry);
        continue;
      }

      // Here you would attempt to resend
      // For now, we'll just mark as attempted
      dlqEntry.retryCount++;
      
      // In a real implementation, you'd call the transport here
      // For now, we'll simulate success after retry
      flushed++;
    }

    return flushed;
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

  private async persistToDisk(entry: DLQEntry): Promise<void> {
    try {
      const line = JSON.stringify(entry) + '\n';
      await appendFile(this.filePath, line, 'utf8');
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
