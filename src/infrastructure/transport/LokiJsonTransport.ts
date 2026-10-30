/**
 * Infrastructure: Loki JSON Transport Implementation
 * Optimized JSON transport using Undici and connection pooling
 */
import { Pool, request } from 'undici';
import { TransportConfig } from '../../application/config/LogsInterceptorConfig';
import { LogEntry } from '../../domain/entities/LogEntry';
import {
  ILogTransport,
  TransportHealth,
  TransportMetrics,
} from '../../domain/interfaces/ILogTransport';
import { ICompressor } from '../compression';
import { CompressorFactory } from '../compression/CompressorFactory';
import { WorkerPool } from '../workers';
import { internalWarn } from '../../utils';
import { consumeResponse } from './consumeResponse';
import { retryAfterNotBefore } from './RetryAfter';

interface LokiStream {
  readonly stream: Record<string, string>;
  readonly values: [string, string][];
}

interface LokiPayload {
  readonly streams: LokiStream[];
}

interface RetryableTransportError extends Error {
  retryAfterNotBefore?: number;
  statusCode?: number;
  retryable?: boolean;
}

export class LokiJsonTransport implements ILogTransport {
  private client?: Pool;
  private health: TransportHealth;
  private compressor: ICompressor;
  private workerPool?: WorkerPool;
  private readonly endpointPath: string;
  private readonly endpointUrl: URL;
  private readonly timeoutMs: number;
  private readonly compressionThreshold: number;
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

    this.timeoutMs = config.timeout ?? 5000;
    this.compressionThreshold = config.compressionThreshold ?? 1024;

    this.compressor = CompressorFactory.create(this.config.compression as any, {
      level: this.config.compressionLevel,
      threshold: this.compressionThreshold,
    });

    if (this.config.useWorkers !== false) {
      try {
        this.workerPool = new WorkerPool({
          maxWorkers: this.config.maxWorkers,
          taskTimeout: this.config.workerTimeout,
        });
      } catch (error) {
        internalWarn('LokiJsonTransport failed to initialize worker pool', error);
      }
    }

    const urlObj = new URL(config.url);
    this.endpointPath = `${urlObj.pathname}${urlObj.search}`;
    this.endpointUrl = urlObj;

    if (config.enableConnectionPooling !== false) {
      this.client = new Pool(urlObj.origin, {
        connections: config.maxSockets ?? 50,
        keepAliveTimeout: 60_000,
        keepAliveMaxTimeout: 600_000,
        headersTimeout: this.timeoutMs,
        bodyTimeout: this.timeoutMs,
        maxResponseSize: 65_536,
        connect: { timeout: this.timeoutMs },
      });
    }
  }

  async send(entries: LogEntry[], signal?: AbortSignal,
    observeRetryAfter?: (notBefore: number | undefined, invalid: boolean) => void): Promise<void> {
    signal?.throwIfAborted();
    if (entries.length === 0) return;

    const startTime = performance.now();
    this.metrics.totalSends++;

    try {
      let payload: LokiPayload;
      if (this.workerPool && entries.length > 50) {
        try {
          payload = await this.workerPool.execute('format', entries, undefined, signal);
        } catch {
          signal?.throwIfAborted();
          payload = this.formatForLoki(entries);
        }
      } else {
        payload = this.formatForLoki(entries);
      }

      const jsonData = JSON.stringify(payload);
      const rawBuffer = Buffer.from(jsonData);
      const rawSize = rawBuffer.length;

      let body: Buffer = rawBuffer;
      let wasCompressed = false;
      let compressionTime = 0;

      const shouldCompress =
        this.compressor.getName() !== 'none' &&
        rawSize >= this.compressionThreshold;

      if (shouldCompress) {
        const compressionStart = performance.now();

        if (this.workerPool && jsonData.length > 10_000) {
          try {
            const type = this.compressor.getName() === 'brotli' ? 'brotli' : 'gzip';
            const workerBody = await this.workerPool.execute<Buffer>(
              'compress',
              jsonData,
              {
                compressionType: type,
                compressionLevel: this.config.compressionLevel,
              }, signal
            );
            body = Buffer.from(workerBody);
          } catch {
            signal?.throwIfAborted();
            body = Buffer.from(await this.compressor.compress(jsonData, signal));
          }
        } else {
          body = Buffer.from(await this.compressor.compress(jsonData, signal));
        }

        compressionTime = performance.now() - compressionStart;
        wasCompressed = true;
      }

      const compressedSize = body.length;

      if (wasCompressed) {
        this.updateCompressionMetrics(compressionTime, rawSize, compressedSize);
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Scope-OrgID': this.config.tenantId ?? '',
        'User-Agent': 'elven-logs-interceptor/2.0.1',
        ...this.extraHeaders,
      };

      if (this.config.authToken) {
        headers.Authorization = `Bearer ${this.config.authToken}`;
      }

      if (wasCompressed) {
        const contentEncoding = this.compressor.getContentEncoding();
        if (contentEncoding) {
          headers['Content-Encoding'] = contentEncoding;
        }
      }

      signal?.throwIfAborted();
      const response = await this.sendRequest(headers, body, signal);

      if (response.statusCode >= 300) {
        const notBefore = retryAfterNotBefore(response.headers['retry-after']);
        if (response.statusCode === 429 || response.statusCode >= 500) observeRetryAfter?.(notBefore.notBefore, notBefore.invalid);
        await consumeResponse(response.body);
        throw this.createHttpError(
          `Loki responded with ${response.statusCode}`,
          response.statusCode,
          notBefore.notBefore
        );
      }

      await consumeResponse(response.body);

      const duration = performance.now() - startTime;
      this.recordSuccess(duration);
      this.metrics.totalBytesSent = (this.metrics.totalBytesSent || 0) + compressedSize;
      this.metrics.totalBytesCompressed =
        (this.metrics.totalBytesCompressed || 0) + rawSize;
    } catch (error) {
      this.recordFailure(error as Error);
      throw error;
    }
  }

  getMetrics(): TransportMetrics {
    return { ...this.metrics };
  }

  private formatForLoki(entries: LogEntry[]): LokiPayload {
    const streamMap = new Map<string, [string, string][]>();

    entries.forEach((entry) => {
      const streamKey = JSON.stringify(entry.labels ?? {});
      const timestamp = String(Date.parse(entry.timestamp) * 1_000_000);

      const logData: Record<string, unknown> = {
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

  private async sendRequest(headers: Record<string, string>, body: Buffer, signal?: AbortSignal) {
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const abort = signal ? AbortSignal.any([signal, deadline]) : deadline;
    if (this.client) {
      return this.client.request({
        path: this.endpointPath,
        method: 'POST',
        headers,
        body,
        signal: abort,
      });
    }

    return request(this.endpointUrl, {
      method: 'POST',
      headers,
      body,
      signal: abort,
      headersTimeout: this.timeoutMs,
      bodyTimeout: this.timeoutMs,
      maxRedirections: 0,
    });
  }

  private createHttpError(message: string, statusCode: number, notBefore?: number): RetryableTransportError {
    const error = new Error(message) as RetryableTransportError;
    error.statusCode = statusCode;
    error.retryable = statusCode === 429 || statusCode >= 500;
    if (error.retryable && notBefore !== undefined) error.retryAfterNotBefore = notBefore;
    return error;
  }

  async isAvailable(): Promise<boolean> {
    return this.health.healthy;
  }

  getHealth(): TransportHealth {
    return { ...this.health };
  }

  async destroy(): Promise<void> {
    if (this.workerPool) {
      await this.workerPool.destroy();
    }

    if (this.client) {
      await this.client.destroy();
    }
  }

  private recordSuccess(duration: number): void {
    this.health = {
      healthy: true,
      consecutiveFailures: 0,
      lastSuccessfulSend: Date.now(),
    };
    this.metrics.successfulSends++;

    const count = this.metrics.successfulSends;
    this.metrics.avgLatency =
      (this.metrics.avgLatency * (count - 1) + duration) / count;
  }

  private updateCompressionMetrics(
    duration: number,
    rawSize: number,
    compressedSize: number
  ): void {
    const count = this.metrics.successfulSends + 1;
    const ratio = rawSize > 0 ? compressedSize / rawSize : 1;

    this.metrics.avgCompressionTime =
      ((this.metrics.avgCompressionTime || 0) * (count - 1) + duration) / count;

    this.metrics.avgCompressionRatio =
      ((this.metrics.avgCompressionRatio || 0) * (count - 1) + ratio) / count;
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
