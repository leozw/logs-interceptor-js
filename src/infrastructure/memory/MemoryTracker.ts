/**
 * Infrastructure: Memory Tracker
 * Efficiently tracks memory usage without expensive JSON.stringify operations
 */
import { LogEntry } from '../../domain/entities/LogEntry';

export interface MemoryStats {
  readonly totalBytes: number;
  readonly totalMB: number;
  readonly entryCount: number;
  readonly avgEntrySize: number;
}

export class MemoryTracker {
  private totalSize = 0;
  private entrySizes = new WeakMap<LogEntry, number>();
  private entryCount = 0;

  /**
   * Add an entry and track its size
   */
  addEntry(entry: LogEntry): void {
    const size = this.estimateSize(entry);
    this.entrySizes.set(entry, size);
    this.totalSize += size;
    this.entryCount++;
  }

  /**
   * Remove an entry and update total size
   */
  removeEntry(entry: LogEntry): void {
    const size = this.entrySizes.get(entry);
    if (size !== undefined) {
      this.totalSize -= size;
      this.entryCount--;
      this.entrySizes.delete(entry);
    }
  }

  /**
   * Remove multiple entries
   */
  removeEntries(entries: LogEntry[]): void {
    entries.forEach(entry => this.removeEntry(entry));
  }

  /**
   * Get total size in bytes
   */
  getTotalSize(): number {
    return this.totalSize;
  }

  /**
   * Get total size in megabytes
   */
  getTotalSizeMB(): number {
    return this.totalSize / 1024 / 1024;
  }

  /**
   * Get entry count
   */
  getEntryCount(): number {
    return this.entryCount;
  }

  /**
   * Get average entry size
   */
  getAvgEntrySize(): number {
    return this.entryCount > 0 ? this.totalSize / this.entryCount : 0;
  }

  /**
   * Get memory statistics
   */
  getStats(): MemoryStats {
    return {
      totalBytes: this.totalSize,
      totalMB: this.getTotalSizeMB(),
      entryCount: this.entryCount,
      avgEntrySize: this.getAvgEntrySize(),
    };
  }

  /**
   * Reset all tracking
   */
  reset(): void {
    this.totalSize = 0;
    this.entryCount = 0;
    // WeakMap will be garbage collected automatically
  }

  /**
   * Estimate size of a log entry without JSON.stringify
   * This is much faster and gives a reasonable approximation
   */
  private estimateSize(entry: LogEntry): number {
    let size = 0;

    // Basic fields
    size += (entry.id?.length || 0) * 2; // UTF-16
    size += (entry.timestamp?.length || 0) * 2;
    size += (entry.level?.length || 0) * 2;
    size += (entry.message?.length || 0) * 2;

    // Optional fields
    if (entry.traceId) size += entry.traceId.length * 2;
    if (entry.spanId) size += entry.spanId.length * 2;
    if (entry.requestId) size += entry.requestId.length * 2;

    // Context - estimate based on key count and average value size
    if (entry.context) {
      const contextKeys = Object.keys(entry.context);
      size += contextKeys.length * 20; // Average key size
      size += contextKeys.length * 50; // Average value size estimate
    }

    // Labels - more accurate since they're strings
    if (entry.labels) {
      Object.entries(entry.labels).forEach(([key, value]) => {
        size += key.length * 2;
        size += value.length * 2;
      });
    }

    // Metadata
    if (entry.metadata) {
      size += 50; // Rough estimate for metadata object
    }

    // Add overhead for object structure (pointers, etc.)
    size += 200; // Object overhead

    return size;
  }
}
