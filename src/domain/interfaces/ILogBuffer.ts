import { LogEntry } from '../entities/LogEntry';

/**
 * Interface for log buffer implementations
 */
export interface ILogBuffer {
  /**
   * Add a log entry to the buffer
   */
  add(entry: LogEntry): void;

  /**
   * Get all entries and clear the buffer
   */
  flush(): LogEntry[];

  /**
   * Get all entries without clearing
   */
  peek(): readonly LogEntry[];

  /**
   * Get current buffer size
   */
  size(): number;

  /**
   * Check if buffer is full
   */
  isFull(): boolean;

  /**
   * Check if buffer should be flushed (by time or size)
   */
  shouldFlush(): boolean;

  /**
   * Clear the buffer
   */
  clear(): void;

  /**
   * Get buffer metrics
   */
  getMetrics(): BufferMetrics;
}

export interface BufferMetrics {
  readonly size: number;
  readonly maxSize: number;
  readonly oldestEntry?: number;
  readonly newestEntry?: number;
  readonly memoryUsageMB: number;
}



