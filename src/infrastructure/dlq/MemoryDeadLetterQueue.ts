/**
 * Infrastructure: In-Memory Dead Letter Queue
 * Simple in-memory implementation for testing or low-volume scenarios
 */
import {
  DeadLetterQueueStats,
  DLQAddResult,
  IDeadLetterQueue,
} from '../../domain/interfaces/IDeadLetterQueue';
import { LogEntry } from '../../domain/entities/LogEntry';

interface DLQEntry {
  entry: LogEntry;
  reason: string;
  timestamp: number;
  retryCount?: number;
}

export class MemoryDeadLetterQueue implements IDeadLetterQueue {
  private queue: DLQEntry[] = [];
  private readonly maxSize: number;
  private droppedEntries = 0;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  async add(entry: LogEntry, reason: string): Promise<DLQAddResult> {
    return this.addBatch([entry], reason);
  }

  async addBatch(entries: LogEntry[], reason: string): Promise<DLQAddResult> {
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

    return {
      added: entries.length,
      dropped,
    };
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
}
