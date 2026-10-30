/**
 * Infrastructure: Loki Protobuf Transport Implementation
 * High-performance, native Loki transport using Protobuf + Snappy + Undici
 */
import * as protobuf from 'protobufjs';
import * as snappy from 'snappy';
import { Pool, request } from 'undici';
import { TransportConfig } from '../../application/config/LogsInterceptorConfig';
import { LogEntry } from '../../domain/entities/LogEntry';
import {
  ILogTransport,
  TransportHealth,
  TransportMetrics,
  TransportDispatch,
} from '../../domain/interfaces/ILogTransport';
import { internalError, internalWarn } from '../../utils';
import { WorkerPool } from '../workers';
import { LOKI_PROTO } from './proto/loki-proto';
import { consumeResponse } from './consumeResponse';
import { retryAfterNotBefore } from './RetryAfter';

interface RetryableTransportError extends Error {
  retryAfterNotBefore?: number;
  statusCode?: number;
  retryable?: boolean;
}

export class LokiProtobufTransport implements ILogTransport {
  private client?: Pool;
  private workerPool?: WorkerPool;
  private root: protobuf.Root | null = null;
  private PushRequest: protobuf.Type | null = null;
  private readonly endpointPath: string;
  private readonly endpointUrl: URL;
  private readonly timeoutMs: number;
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

  constructor(
    private readonly config: TransportConfig,
    private readonly extraHeaders: Record<string, string> = {}
  ) {
    this.timeoutMs = config.timeout ?? 5000;

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

    if (this.config.useWorkers !== false) {
      try {
        this.workerPool = new WorkerPool({
          maxWorkers: this.config.maxWorkers,
          taskTimeout: this.config.workerTimeout,
        });
      } catch (error) {
        internalWarn('LokiProtobufTransport failed to initialize worker pool', error);
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
      internalError('LokiProtobufTransport failed to initialize protobuf', error);
      throw error;
    }
  }

  async send(entries: LogEntry[], signal?: AbortSignal,
    observeRetryAfter?: (notBefore: number | undefined, invalid: boolean) => void,
    dispatch?: TransportDispatch): Promise<void> {
    signal?.throwIfAborted();
    if (entries.length === 0) return;
    if (!this.PushRequest) throw new Error('Protobuf not initialized');

    const startTime = performance.now();
    this.metrics.totalSends++;

    try {
      let compressed: Buffer;
      let compressedSize: number;
      let rawSize = 0;
      let compressionTime = 0;

      if (this.workerPool && entries.length > 50) {
        try {
          const workerStart = performance.now();
          compressed = await this.workerPool.execute<Buffer>(
            'encodeProtobufAndCompress',
            entries, undefined, signal
          );
          compressedSize = compressed.length;
          compressionTime = performance.now() - workerStart;
          rawSize = entries.length * 150;
        } catch (error) {
          signal?.throwIfAborted();
          internalWarn('LokiProtobufTransport worker failed, falling back to main thread', error);
          const fallback = await this.encodeMainThread(entries);
          compressed = fallback.compressed;
          compressedSize = fallback.compressedSize;
          rawSize = fallback.rawSize;
          compressionTime = fallback.compressionTime;
        }
      } else {
        const fallback = await this.encodeMainThread(entries);
        compressed = fallback.compressed;
        compressedSize = fallback.compressedSize;
        rawSize = fallback.rawSize;
        compressionTime = fallback.compressionTime;
      }

      this.updateCompressionMetrics(compressionTime, rawSize, compressedSize);

      const headers: Record<string, string> = {
        'Content-Type': 'application/x-protobuf',
        'Content-Encoding': 'snappy',
        'X-Scope-OrgID': this.config.tenantId ?? '',
        'User-Agent': 'elven-logs-interceptor/2.0.1',
        ...this.extraHeaders,
      };

      if (this.config.authToken) {
        headers.Authorization = `Bearer ${this.config.authToken}`;
      }

      signal?.throwIfAborted();
      const invokeRequest = () => this.sendRequest(headers, compressed, signal);
      const response = await (dispatch ? dispatch(invokeRequest) : invokeRequest());

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

  private async encodeMainThread(
    entries: LogEntry[]
  ): Promise<{
    compressed: Buffer;
    rawSize: number;
    compressedSize: number;
    compressionTime: number;
  }> {
    const streams = this.groupEntries(entries);

    const payload = {
      streams: streams.map(({ labels, entries: streamEntries }) => ({
        labels: this.formatLabels(labels),
        entries: streamEntries.map((entry: LogEntry) => ({
          timestamp: this.getProtobufTimestamp(entry.timestamp),
          line: this.formatLogLine(entry),
        })),
      })),
    };

    const errMsg = this.PushRequest!.verify(payload);
    if (errMsg) throw new Error(`Protobuf verification failed: ${errMsg}`);

    const encoded = this.PushRequest!.encode(payload).finish();
    const rawSize = encoded.length;

    const compressionStart = performance.now();
    const compressed = await snappy.compress(Buffer.from(encoded));
    const compressionTime = performance.now() - compressionStart;
    const compressedSize = compressed.length;

    return { compressed, rawSize, compressedSize, compressionTime };
  }

  private groupEntries(
    entries: LogEntry[]
  ): { labels: Record<string, string>; entries: LogEntry[] }[] {
    const groups = new Map<string, { labels: Record<string, string>; entries: LogEntry[] }>();

    for (const entry of entries) {
      const labels = entry.labels || {};
      const keys = Object.keys(labels).sort();
      const id = keys.map((k) => `${k}="${labels[k]}"`).join(',');

      if (!groups.has(id)) {
        groups.set(id, { labels, entries: [] });
      }
      groups.get(id)!.entries.push(entry);
    }

    return Array.from(groups.values());
  }

  private formatLabels(labels: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) return '{}';
    const pairs = Object.keys(labels)
      .sort()
      .map((k) => `${k}="${this.escapeLabelValue(labels[k])}"`);
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
    const { id: _id, timestamp: _timestamp, labels: _labels, ...rest } = entry;
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
