/**
 * Infrastructure: Loki Protobuf Transport Implementation
 * High-performance, native Loki transport using Protobuf + Snappy + Undici
 */
import * as protobuf from 'protobufjs';
import * as snappy from 'snappy';
import { Pool } from 'undici';
import { TransportConfig } from '../../application/config/LogsInterceptorConfig';
import { LogEntry } from '../../domain/entities/LogEntry';
import { ILogTransport, TransportHealth, TransportMetrics } from '../../domain/interfaces/ILogTransport';
import { WorkerPool } from '../workers';
import { LOKI_PROTO } from './proto/loki-proto';

export class LokiProtobufTransport implements ILogTransport {
  private client: Pool;
  private workerPool?: WorkerPool;
  private root: protobuf.Root | null = null;
  private PushRequest: protobuf.Type | null = null;
  private health: TransportHealth = {
    healthy: true,
    consecutiveFailures: 0,
  };
  private metrics: TransportMetrics = {
    totalSends: 0,
    successfulSends: 0,
    failedSends: 0,
    avgLatency: 0,
    avgCompressionTime: 0,
    avgCompressionRatio: 0,
    totalBytesSent: 0,
    totalBytesCompressed: 0,
  };
  private readonly endpointPath: string;

  constructor(
    private readonly config: TransportConfig,
    private readonly extraHeaders: Record<string, string> = {}
  ) {
    const urlObj = new URL(config.url);
    this.endpointPath = urlObj.pathname;

    this.client = new Pool(urlObj.origin, {
      connections: config.maxSockets ?? 50,
      keepAliveTimeout: 60000,
      keepAliveMaxTimeout: 600000,
      headersTimeout: config.timeout ?? 5000,
      bodyTimeout: config.timeout ?? 5000,
    });

    // Initialize worker pool if enabled
    if (this.config.useWorkers !== false) {
      try {
        this.workerPool = new WorkerPool({
          maxWorkers: this.config.maxWorkers,
        });
      } catch (error) {
        console.warn('[LokiProtobufTransport] Failed to initialize worker pool:', error);
      }
    }

    this.initProtobuf();
  }

  private initProtobuf(): void {
    try {
      const parsed = protobuf.parse(LOKI_PROTO);
      this.root = parsed.root;
      this.PushRequest = this.root.lookupType('logproto.PushRequest');
    } catch (error) {
      console.error('[LokiProtobufTransport] Failed to initialize Protobuf:', error);
      throw error;
    }
  }

  async send(entries: LogEntry[]): Promise<void> {
    if (entries.length === 0) return;
    if (!this.PushRequest) throw new Error('Protobuf not initialized');

    const startTime = performance.now();
    this.metrics.totalSends++;

    try {
      let compressed: Buffer;
      let compressedSize: number;
      let rawSize = 0; // fallback default
      let compressionTime = 0;

      if (this.workerPool && entries.length > 50) {
        // Offload Protobuf Encode + Snappy to Worker
        try {
          const startTimeWorker = performance.now();
          // We need response type any because we added metrics
          const workerResult = await this.workerPool.execute<Buffer>('encodeProtobufAndCompress', entries);
          compressed = workerResult as Buffer;
          compressedSize = compressed.length;
          compressionTime = performance.now() - startTimeWorker;
          // Approximate raw size since it's hidden in the worker (unless we change execute signature)
          // We assume raw size is roughly length * 150 for metric purposes
          rawSize = entries.length * 150;
        } catch (error) {
          console.warn('[LokiProtobufTransport] Worker failed, falling back to main thread', error);
          const fb = await this.encodeMainThread(entries);
          compressed = fb.compressed;
          compressedSize = fb.compressedSize;
          rawSize = fb.rawSize;
          compressionTime = fb.compressionTime;
        }
      } else {
        // Run on Main Thread
        const fb = await this.encodeMainThread(entries);
        compressed = fb.compressed;
        compressedSize = fb.compressedSize;
        rawSize = fb.rawSize;
        compressionTime = fb.compressionTime;
      }

      // Update compression metrics
      this.updateCompressionMetrics(compressionTime, rawSize, compressedSize);

      // 5. Send via Undici
      const headers: Record<string, string> = {
        'Content-Type': 'application/x-protobuf',
        'Content-Encoding': 'snappy', // Usually implicit for x-protobuf in Loki, but safe to add
        'X-Scope-OrgID': this.config.tenantId,
        'User-Agent': 'logs-interceptor/2.0.0',
        ...this.extraHeaders,
      };

      if (this.config.authToken) {
        headers['Authorization'] = `Bearer ${this.config.authToken}`;
      }

      const response = await this.client.request({
        path: this.endpointPath,
        method: 'POST',
        headers,
        body: compressed,
      });

      if (response.statusCode >= 300) {
        const body = await response.body.text();
        throw new Error(`Loki responded with ${response.statusCode}: ${body}`);
      } else {
        // Consume body to free socket
        await response.body.text();
      }

      const duration = performance.now() - startTime;
      this.recordSuccess(duration);
      this.metrics.totalBytesSent = (this.metrics.totalBytesSent || 0) + compressedSize;
    } catch (error) {
      this.recordFailure(error as Error);
      throw error;
    }
  }

  private async encodeMainThread(entries: LogEntry[]): Promise<{ compressed: Buffer; rawSize: number; compressedSize: number; compressionTime: number }> {
    // 1. Group by stream (labels)
    const streams = this.groupEntries(entries);

    // 2. Create Protobuf payload
    const payload = {
      streams: streams.map(({ labels, entries }) => ({
        labels: this.formatLabels(labels),
        entries: entries.map((entry: LogEntry) => ({
          timestamp: this.getProtobufTimestamp(entry.timestamp),
          line: this.formatLogLine(entry),
        })),
      })),
    };

    // 3. Encode to Protobuf
    const errMsg = this.PushRequest!.verify(payload);
    if (errMsg) throw new Error(`Protobuf verification failed: ${errMsg}`);

    const buffer = this.PushRequest!.encode(payload).finish();
    const rawSize = buffer.length;

    // 4. Compress with Snappy
    const compressionStart = performance.now();
    const compressed = await snappy.compress(Buffer.from(buffer));
    const compressionTime = performance.now() - compressionStart;
    const compressedSize = compressed.length;

    return { compressed, rawSize, compressedSize, compressionTime };
  }

  private groupEntries(entries: LogEntry[]): { labels: Record<string, string>; entries: LogEntry[] }[] {
    const groups = new Map<string, { labels: Record<string, string>; entries: LogEntry[] }>();

    for (const entry of entries) {
      const labels = entry.labels || {};
      // Sort keys for consistent ID
      const keys = Object.keys(labels).sort();
      const id = keys.map(k => `${k}="${labels[k]}"`).join(',');

      if (!groups.has(id)) {
        groups.set(id, { labels, entries: [] });
      }
      groups.get(id)!.entries.push(entry);
    }

    return Array.from(groups.values());
  }

  private formatLabels(labels: Record<string, string>): string {
    // Loki expects: {foo="bar", baz="qux"}
    if (!labels || Object.keys(labels).length === 0) return '{}';
    const pairs = Object.keys(labels)
      .sort()
      .map(k => `${k}="${this.escapeLabelValue(labels[k])}"`);
    return `{${pairs.join(',')}}`;
  }

  private escapeLabelValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private getProtobufTimestamp(isoString: string): { seconds: number; nanos: number } {
    const date = new Date(isoString);
    const ms = date.getTime();
    return {
      seconds: Math.floor(ms / 1000),
      nanos: (ms % 1000) * 1_000_000,
    };
  }

  private formatLogLine(entry: LogEntry): string {
    const { id, timestamp, labels, ...rest } = entry;
    // We send everything else as JSON line
    return JSON.stringify(rest);
  }

  async isAvailable(): Promise<boolean> {
    return this.health.healthy;
  }

  getHealth(): TransportHealth {
    return { ...this.health };
  }

  getMetrics(): TransportMetrics {
    return { ...this.metrics };
  }

  async destroy(): Promise<void> {
    if (this.workerPool) {
      await this.workerPool.destroy();
    }
    await this.client.close();
  }

  private recordSuccess(duration: number): void {
    this.health = {
      healthy: true,
      consecutiveFailures: 0,
      lastSuccessfulSend: Date.now(),
    };
    this.metrics.successfulSends++;

    // Update avg latency
    const count = this.metrics.successfulSends;
    this.metrics.avgLatency =
      (this.metrics.avgLatency * (count - 1) + duration) / count;
  }

  private updateCompressionMetrics(duration: number, rawSize: number, compressedSize: number): void {
    const count = this.metrics.successfulSends + 1; // Approximate
    const ratio = rawSize > 0 ? compressedSize / rawSize : 1;

    this.metrics.avgCompressionTime =
      ((this.metrics.avgCompressionTime || 0) * (count - 1) + duration) / count;

    this.metrics.avgCompressionRatio =
      ((this.metrics.avgCompressionRatio || 0) * (count - 1) + ratio) / count;

    this.metrics.totalBytesCompressed = (this.metrics.totalBytesCompressed || 0) + rawSize;
  }

  private recordFailure(error: Error): void {
    this.health = {
      healthy: false,
      consecutiveFailures: this.health.consecutiveFailures + 1,
      errorMessage: error.message,
    };
    this.metrics.failedSends++;
  }
}
