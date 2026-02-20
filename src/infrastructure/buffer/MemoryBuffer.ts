/**
 * Infrastructure: Memory Buffer Implementation
 * Enhanced with efficient memory tracking
 */
import { LogEntry } from '../../domain/entities/LogEntry';
import { BufferMetrics, ILogBuffer } from '../../domain/interfaces/ILogBuffer';
import { MemoryTracker } from '../memory/MemoryTracker';

export interface MemoryBufferConfig {
  readonly maxSize: number;
  readonly flushInterval: number;
  readonly maxAge: number;
  readonly autoFlush: boolean;
  readonly maxMemoryMB: number;
  readonly onFlushRequested?: () => void; // Callback when flush should be triggered
}

export class MemoryBuffer implements ILogBuffer {
  private entries: LogEntry[] = [];
  private lastFlushTime: number = Date.now();
  private flushTimer: NodeJS.Timeout | null = null;
  private memoryTracker: MemoryTracker;
  private flushCallback?: () => void;

  constructor(private readonly config: MemoryBufferConfig) {
    this.memoryTracker = new MemoryTracker();
    this.flushCallback = config.onFlushRequested;
    if (config.autoFlush) {
      this.scheduleFlush();
    }
  }

  /**
   * Set callback to be called when flush is requested by timer
   */
  setFlushCallback(callback: () => void): void {
    this.flushCallback = callback;
  }

  add(entry: LogEntry): void {
    this.entries.push(entry);
    this.memoryTracker.addEntry(entry);

    // Check memory threshold
    const memoryMB = this.memoryTracker.getTotalSizeMB();
    if (memoryMB > this.config.maxMemoryMB) {
      // Force flush if memory threshold exceeded
      if (this.config.autoFlush) {
        this.scheduleFlush();
      } else {
        // If auto-flush is off and we are out of memory, we MUST drop old entries to prevent crash
        this.removeOldEntries();
      }
    }

    // Ensure a flush timer is running so logs don't sit forever
    if (this.config.autoFlush) {
      this.scheduleFlush();
    }

    // Auto-flush immediately if buffer is full (Burst Mode)
    if (this.entries.length >= this.config.maxSize && this.config.autoFlush) {
      this.triggerImmediateFlush();
    }
  }

  private triggerImmediateFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Use setImmediate to allow current event loop tick to finish
    // and prevent potential recursion issues
    setImmediate(() => {
      if (this.flushCallback && this.entries.length > 0) {
        this.flushCallback();
      }
    });
  }

  flush(): LogEntry[] {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const entries = [...this.entries];
    this.memoryTracker.removeEntries(entries);
    this.entries = [];
    this.lastFlushTime = Date.now();

    if (this.config.autoFlush) {
      this.scheduleFlush();
    }

    return entries;
  }

  peek(): readonly LogEntry[] {
    return [...this.entries];
  }

  size(): number {
    return this.entries.length;
  }

  isFull(): boolean {
    return this.entries.length >= this.config.maxSize;
  }

  shouldFlush(): boolean {
    const timeSinceLastFlush = Date.now() - this.lastFlushTime;
    return (
      this.entries.length >= this.config.maxSize ||
      (this.config.autoFlush &&
        timeSinceLastFlush >= this.config.flushInterval)
    );
  }

  clear(): void {
    this.memoryTracker.removeEntries(this.entries);
    this.entries = [];
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  getMetrics(): BufferMetrics {
    const oldestEntry = this.entries[0]
      ? Date.parse(this.entries[0].timestamp)
      : undefined;
    const newestEntry = this.entries[this.entries.length - 1]
      ? Date.parse(this.entries[this.entries.length - 1].timestamp)
      : undefined;

    // Use efficient memory tracking instead of expensive JSON.stringify
    const memoryStats = this.memoryTracker.getStats();

    return {
      size: this.entries.length,
      maxSize: this.config.maxSize,
      oldestEntry,
      newestEntry,
      memoryUsageMB: memoryStats.totalMB,
    };
  }

  private removeOldEntries(): void {
    const now = Date.now();
    const maxAge = this.config.maxAge;

    const removed: LogEntry[] = [];
    this.entries = this.entries.filter((entry) => {
      const entryAge = now - Date.parse(entry.timestamp);
      if (entryAge >= maxAge) {
        removed.push(entry);
        return false;
      }
      return true;
    });

    // If still full, remove oldest entries
    if (this.entries.length >= this.config.maxSize) {
      const removeCount = Math.floor(this.config.maxSize * 0.1);
      const oldest = this.entries.slice(0, removeCount);
      removed.push(...oldest);
      this.entries = this.entries.slice(removeCount);
    }

    // Update memory tracker
    if (removed.length > 0) {
      this.memoryTracker.removeEntries(removed);
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      // Notify service that flush should be triggered
      if (this.flushCallback && this.entries.length > 0) {
        this.flushCallback();
      }
    }, this.config.flushInterval);
  }
}



