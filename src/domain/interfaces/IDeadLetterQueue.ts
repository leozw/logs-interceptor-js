/**
 * Domain Interface: IDeadLetterQueue
 * Contract for dead letter queue implementations
 */
import { LogEntry } from '../entities/LogEntry';

export interface IDeadLetterQueue {
  /**
   * Add a log entry to the dead letter queue
   * @param entry Log entry that failed to send
   * @param reason Reason for failure
   */
  add(entry: LogEntry, reason: string): Promise<DLQAddResult>;

  /**
   * Add multiple entries to DLQ in a single batch
   */
  addBatch(entries: LogEntry[], reason: string): Promise<DLQAddResult>;

  /**
   * Attempt to flush entries from DLQ
   */
  flush(): Promise<number>; // Returns number of entries flushed

  /**
   * Get current size of DLQ
   */
  size(): number;

  /**
   * Clear all entries from DLQ
   */
  clear(): Promise<void>;

  /**
   * Get entries (for retry or inspection)
   */
  getEntries(limit?: number): Promise<Array<{ entry: LogEntry; reason: string; timestamp: number }>>;

  /**
   * Queue statistics
   */
  getStats(): DeadLetterQueueStats;
}

export interface DLQAddResult {
  added: number;
  dropped: number;
}

export interface DeadLetterQueueStats {
  size: number;
  droppedEntries: number;
}
