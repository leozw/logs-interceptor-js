/**
 * Infrastructure: In-Memory Dead Letter Queue
 * Simple in-memory implementation for testing or low-volume scenarios
 */
import { LogEntry } from '../../domain/entities/LogEntry';
import { IDeadLetterQueue } from '../../domain/interfaces/IDeadLetterQueue';

interface DLQEntry {
  entry: LogEntry;
  reason: string;
  timestamp: number;
  retryCount?: number;
}

export class MemoryDeadLetterQueue implements IDeadLetterQueue {
  private queue: DLQEntry[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  async add(entry: LogEntry, reason: string): Promise<void> {
    return this.addBatch([entry], reason);
  }

  async addBatch(entries: LogEntry[], reason: string): Promise<void> {
    const timestamp = Date.now();
    for (const entry of entries) {
      this.queue.push({
        entry,
        reason,
        timestamp,
        retryCount: 0,
      });
    }

    // Trim execution is cheap in memory
    if (this.queue.length > this.maxSize) {
      this.queue = this.queue.slice(this.queue.length - this.maxSize);
    }
  }

  async flush(): Promise<number> {
    const count = this.queue.length;
    this.queue = [];
    return count;
  }

  size(): number {
    return this.queue.length;
  }

  async clear(): Promise<void> {
    this.queue = [];
  }

  async getEntries(limit: number = 100): Promise<Array<{ entry: LogEntry; reason: string; timestamp: number }>> {
    return this.queue
      .slice(0, limit)
      .map(({ entry, reason, timestamp }) => ({ entry, reason, timestamp }));
  }
}
