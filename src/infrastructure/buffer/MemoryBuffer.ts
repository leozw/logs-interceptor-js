/**
 * Infrastructure: Memory Buffer Implementation
 * Enhanced with efficient memory tracking and bounded memory policy
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
  readonly onFlushRequested?: () => void;
}

export class MemoryBuffer implements ILogBuffer {
  private entries: LogEntry[] = [];
  private lastFlushTime: number = Date.now();
  private flushTimer: NodeJS.Timeout | null = null;
  private immediateFlush: NodeJS.Immediate | null = null;
  private memoryTracker: MemoryTracker;
  private flushCallback?: () => void;
  private droppedEntries = 0;
  private destroyed = false;

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
    if (this.destroyed) {
      return;
    }

    this.entries.push(entry);
    this.memoryTracker.addEntry(entry);

    this.enforceMaxSize();

    const memoryMB = this.memoryTracker.getTotalSizeMB();
    if (memoryMB > this.config.maxMemoryMB) {
      this.removeOldEntries();
      this.enforceMaxSize();
    }

    if (this.config.autoFlush) {
      this.scheduleFlush();
    }

    if (this.entries.length >= this.config.maxSize && this.config.autoFlush) {
      this.triggerImmediateFlush();
    }
  }

  private enforceMaxSize(): void {
    if (this.entries.length <= this.config.maxSize) {
      return;
    }

    const removeCount = this.entries.length - this.config.maxSize;
    this.dropOldest(removeCount);
  }

  private dropOldest(count: number): void {
    if (count <= 0 || this.entries.length === 0) {
      return;
    }

    const toDrop = this.entries.slice(0, count);
    this.entries = this.entries.slice(count);
    this.memoryTracker.removeEntries(toDrop);
    this.droppedEntries += toDrop.length;
  }

  private triggerImmediateFlush(): void {
    if (this.destroyed || this.immediateFlush) {
      return;
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    this.immediateFlush = setImmediate(() => {
      this.immediateFlush = null;
      if (this.destroyed) {
        return;
      }

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

    if (this.config.autoFlush && !this.destroyed) {
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
      (this.config.autoFlush && timeSinceLastFlush >= this.config.flushInterval)
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

  destroy(): void {
    this.destroyed = true;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.immediateFlush) {
      clearImmediate(this.immediateFlush);
      this.immediateFlush = null;
    }

    this.clear();
    this.memoryTracker.reset();
    this.flushCallback = undefined;
  }

  getMetrics(): BufferMetrics {
    const oldestEntry = this.entries[0]
      ? Date.parse(this.entries[0].timestamp)
      : undefined;
    const newestEntry = this.entries[this.entries.length - 1]
      ? Date.parse(this.entries[this.entries.length - 1].timestamp)
      : undefined;

    const memoryStats = this.memoryTracker.getStats();

    return {
      size: this.entries.length,
      maxSize: this.config.maxSize,
      oldestEntry,
      newestEntry,
      memoryUsageMB: memoryStats.totalMB,
      droppedEntries: this.droppedEntries,
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

    if (removed.length > 0) {
      this.memoryTracker.removeEntries(removed);
      this.droppedEntries += removed.length;
    }

    while (
      this.entries.length > 0 &&
      this.memoryTracker.getTotalSizeMB() > this.config.maxMemoryMB
    ) {
      const removeCount = Math.max(1, Math.floor(this.entries.length * 0.1));
      this.dropOldest(removeCount);
    }
  }

  private scheduleFlush(): void {
    if (this.destroyed || this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;

      if (this.destroyed) {
        return;
      }

      if (this.flushCallback && this.entries.length > 0) {
        this.flushCallback();
      }
    }, this.config.flushInterval);

    this.flushTimer.unref?.();
  }
}
