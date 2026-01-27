/**
 * Infrastructure: Advanced Metrics Collector
 * Tracks latency percentiles, throughput, and other advanced metrics
 */
import { performance } from 'perf_hooks';

export interface LatencyMetrics {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly p999: number;
  readonly min: number;
  readonly max: number;
  readonly avg: number;
  readonly count: number;
}

export interface CompressionMetrics {
  readonly avgRatio: number;
  readonly avgTime: number;
  readonly totalOriginalBytes: number;
  readonly totalCompressedBytes: number;
  readonly totalSavedBytes: number;
  readonly count: number;
}

export class MetricsCollector {
  private latencies: number[] = [];
  private compressionRatios: number[] = [];
  private compressionTimes: number[] = [];
  private totalOriginalBytes = 0;
  private totalCompressedBytes = 0;
  private readonly maxSamples = 10000; // Keep last 10k samples

  /**
   * Record a latency measurement
   */
  recordLatency(ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > this.maxSamples) {
      this.latencies.shift();
    }
  }

  /**
   * Record compression metrics
   */
  recordCompression(
    originalSize: number,
    compressedSize: number,
    timeMs: number
  ): void {
    this.totalOriginalBytes += originalSize;
    this.totalCompressedBytes += compressedSize;

    if (originalSize > 0) {
      const ratio = (1 - compressedSize / originalSize) * 100;
      this.compressionRatios.push(ratio);
      if (this.compressionRatios.length > this.maxSamples) {
        this.compressionRatios.shift();
      }
    }

    this.compressionTimes.push(timeMs);
    if (this.compressionTimes.length > this.maxSamples) {
      this.compressionTimes.shift();
    }
  }

  /**
   * Get latency percentiles
   */
  getLatencyMetrics(): LatencyMetrics {
    if (this.latencies.length === 0) {
      return {
        p50: 0,
        p95: 0,
        p99: 0,
        p999: 0,
        min: 0,
        max: 0,
        avg: 0,
        count: 0,
      };
    }

    const sorted = [...this.latencies].sort((a, b) => a - b);
    const count = sorted.length;

    return {
      p50: this.getPercentile(sorted, 50),
      p95: this.getPercentile(sorted, 95),
      p99: this.getPercentile(sorted, 99),
      p999: this.getPercentile(sorted, 99.9),
      min: sorted[0],
      max: sorted[count - 1],
      avg: this.latencies.reduce((a, b) => a + b, 0) / count,
      count,
    };
  }

  /**
   * Get compression metrics
   */
  getCompressionMetrics(): CompressionMetrics {
    const count = this.compressionRatios.length;
    const avgRatio =
      count > 0
        ? this.compressionRatios.reduce((a, b) => a + b, 0) / count
        : 0;
    const avgTime =
      this.compressionTimes.length > 0
        ? this.compressionTimes.reduce((a, b) => a + b, 0) /
          this.compressionTimes.length
        : 0;

    return {
      avgRatio,
      avgTime,
      totalOriginalBytes: this.totalOriginalBytes,
      totalCompressedBytes: this.totalCompressedBytes,
      totalSavedBytes: this.totalOriginalBytes - this.totalCompressedBytes,
      count,
    };
  }

  /**
   * Calculate percentile from sorted array
   */
  private getPercentile(sorted: number[], percentile: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.latencies = [];
    this.compressionRatios = [];
    this.compressionTimes = [];
    this.totalOriginalBytes = 0;
    this.totalCompressedBytes = 0;
  }

  /**
   * Get throughput (operations per second)
   */
  getThroughput(windowSeconds: number = 60): number {
    const now = Date.now();
    const windowStart = now - windowSeconds * 1000;
    
    // For simplicity, estimate based on recent samples
    // In production, you'd track timestamps
    const recentCount = Math.min(this.latencies.length, 1000);
    return (recentCount / windowSeconds) * (this.latencies.length / recentCount);
  }
}
