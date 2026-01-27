/**
 * Infrastructure: In-Memory Dead Letter Queue
 * Simple in-memory implementation for testing or low-volume scenarios
 */
import { IDeadLetterQueue } from '../../domain/interfaces/IDeadLetterQueue';
import { LogEntry } from '../../domain/entities/LogEntry';

interface DLQEntry {
  entry: LogEntry;
  reason: string;
  timestamp: number;
}

export class MemoryDeadLetterQueue implements IDeadLetterQueue {
  private queue: DLQEntry[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  async add(entry: LogEntry, reason: string): Promise<void> {
    const dlqEntry: DLQEntry = {
      entry,
      reason,
      timestamp: Date.now(),
    };

    this.queue.push(dlqEntry);

    // Trim if exceeds max size (FIFO)
    if (this.queue.length > this.maxSize) {
      this.queue.shift();
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
