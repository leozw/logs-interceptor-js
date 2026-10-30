/**
 * Infrastructure: Loki JSON Transport Implementation
 * Optimized JSON transport using Undici and connection pooling
 */
import { Pool } from 'undici';
import { TransportConfig } from '../../application/config/LogsInterceptorConfig';
import { LogEntry } from '../../domain/entities/LogEntry';
import { ILogTransport, TransportHealth, TransportMetrics } from '../../domain/interfaces/ILogTransport';
import { ICompressor } from '../compression';
import { CompressorFactory } from '../compression/CompressorFactory';
import { WorkerPool } from '../workers';
import { RetryGate, responseError, sendScope } from './RetryPolicy';

interface LokiStream {
  readonly stream: Record<string, string>;
  readonly values: [string, string][];
}

interface LokiPayload {
  readonly streams: LokiStream[];
}

export class LokiJsonTransport implements ILogTransport {
  private retryGate = new RetryGate();
  private client: Pool;
  private health: TransportHealth;
  private compressor: ICompressor;
  private workerPool?: WorkerPool;
  private readonly endpointPath: string;
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

  constructor(
    private readonly config: TransportConfig,
    private readonly extraHeaders: Record<string, string> = {}
  ) {
    this.health = {
      healthy: true,
      consecutiveFailures: 0,
    };

    // Initialize compressor
    this.compressor = CompressorFactory.create(
      this.config.compression as any, // Cast because of complex type union
      {
        level: this.config.compressionLevel,
        threshold: this.config.compressionThreshold,
      }
    );

    // Initialize worker pool if enabled
    if (this.config.useWorkers !== false) {
      try {
        this.workerPool = new WorkerPool({
          maxWorkers: this.config.maxWorkers,
        });
      } catch (error) {
        console.warn('[LokiJsonTransport] Failed to initialize worker pool:', error);
      }
    }

    const urlObj = new URL(config.url);
    this.endpointPath = urlObj.pathname;

    this.client = new Pool(urlObj.origin, {
      connections: config.maxSockets ?? 50,
      keepAliveTimeout: 60000,
      keepAliveMaxTimeout: 600000,
      headersTimeout: config.timeout ?? 5000,
      bodyTimeout: config.timeout ?? 5000,
      maxResponseSize: 65536,
      connect: { timeout: config.timeout ?? 5000 },
    });
  }

  async send(entries: LogEntry[], signal?: AbortSignal): Promise<void> {
    if (entries.length === 0) return;

    const startTime = performance.now();
    this.metrics.totalSends++;
    const scope = sendScope(this.config.timeout ?? 5000, [this.retryGate.signal(), ...(signal ? [signal] : [])]);

    try {
      await this.retryGate.wait(scope.deadline, scope.signal);
      // Format payload
      let payload: any;
      if (this.workerPool && entries.length > 50) {
        try {
          payload = await this.workerPool.execute('format', entries, undefined, scope.signal);
        } catch (error) {
          scope.signal.throwIfAborted();
          payload = this.formatForLoki(entries);
        }
      } else {
        payload = this.formatForLoki(entries);
      }

      const jsonData = JSON.stringify(payload);
      const rawSize = Buffer.byteLength(jsonData);

      // Compress
      let compressedData: Buffer;
      const compressionStart = performance.now();
      if (this.workerPool && jsonData.length > 10000 && this.compressor.getName() !== 'none') {
        try {
          // Use 'gzip' or 'brotli' based on compressor
          const type = this.compressor.getName() === 'brotli' ? 'brotli' : 'gzip';
          compressedData = await this.workerPool.execute('compress', jsonData, {
            compressionType: type,
            compressionLevel: this.config.compressionLevel,
          }, scope.signal);
        } catch (error) {
          scope.signal.throwIfAborted();
          compressedData = await this.compressor.compress(jsonData);
        }
      } else {
        compressedData = await this.compressor.compress(jsonData);
      }
      const compressionTime = performance.now() - compressionStart;
      const compressedSize = compressedData.length;

      this.updateCompressionMetrics(compressionTime, rawSize, compressedSize);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Scope-OrgID': this.config.tenantId,
        'User-Agent': 'logs-interceptor/2.0.0',
        ...this.extraHeaders,
      };

      if (this.config.authToken) {
        headers['Authorization'] = `Bearer ${this.config.authToken}`;
      }

      const contentEncoding = this.compressor.getContentEncoding();
      if (contentEncoding) {
        headers['Content-Encoding'] = contentEncoding;
      }

      const response = await this.retryGate.dispatch(scope.deadline, scope.signal, () => this.client.request({
        path: this.endpointPath,
        method: 'POST',
        headers,
        body: compressedData,
        signal: scope.signal,
      }));

      if (response.statusCode >= 300) {
        const failure = responseError(response.statusCode, response.headers, this.config.retryDelay ?? 1000);
        this.retryGate.observe(failure);
        await response.body.text().catch(() => {});
        throw failure;
      } else {
        await response.body.text();
      }

      const duration = performance.now() - startTime;
      this.recordSuccess(duration);
      this.metrics.totalBytesSent = (this.metrics.totalBytesSent || 0) + compressedSize;
    } catch (error) {
      this.recordFailure(error as Error);
      throw error;
    } finally { scope.close(); }
  }

  getMetrics(): TransportMetrics {
    return { ...this.metrics };
  }

  private formatForLoki(entries: LogEntry[]): LokiPayload {
    const streamMap = new Map<string, [string, string][]>();

    entries.forEach((entry) => {
      const streamKey = JSON.stringify(entry.labels ?? {});
      const timestamp = String(Date.parse(entry.timestamp) * 1_000_000);

      const logData: Record<string, any> = {
        id: entry.id,
        level: entry.level,
        message: entry.message,
        context: entry.context,
      };

      if (entry.traceId && entry.traceId !== 'undefined') logData.traceId = entry.traceId;
      if (entry.spanId && entry.spanId !== 'undefined') logData.spanId = entry.spanId;
      if (entry.requestId && entry.requestId !== 'undefined') logData.requestId = entry.requestId;
      if (entry.metadata) logData.metadata = entry.metadata;

      const logLine = JSON.stringify(logData);

      if (!streamMap.has(streamKey)) {
        streamMap.set(streamKey, []);
      }
      streamMap.get(streamKey)!.push([timestamp, logLine]);
    });

    return {
      streams: Array.from(streamMap.entries()).map(([streamKey, values]) => ({
        stream: JSON.parse(streamKey),
        values: values.sort((a, b) => a[0].localeCompare(b[0])),
      })),
    };
  }

  async isAvailable(): Promise<boolean> {
    return this.health.healthy;
  }

  getHealth(): TransportHealth {
    return { ...this.health, rateLimitCodes: this.retryGate.diagnostics() };
  }

  async destroy(): Promise<void> {
    this.retryGate.close();
    if (this.workerPool) {
      await this.workerPool.destroy();
    }
    await this.client.destroy();
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
