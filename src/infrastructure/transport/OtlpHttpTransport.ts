import { TraceFlags } from '@opentelemetry/api';
import { SeverityNumber, type AnyValue, type LogAttributes } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { CompressionAlgorithm } from '@opentelemetry/otlp-exporter-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs';
import { ResolvedLogsInterceptorConfig } from '../../application/config/LogsInterceptorConfig';
import { LogEntry } from '../../domain/entities/LogEntry';
import {
  ILogTransport,
  TransportHealth,
  TransportMetrics,
} from '../../domain/interfaces/ILogTransport';

const instrumentationScope = {
  name: 'elven-logs-interceptor',
  version: '1.1.0',
};

export class OtlpHttpTransport implements ILogTransport {
  private readonly exporter: OTLPLogExporter;
  private readonly resource: ReturnType<typeof resourceFromAttributes>;
  private health: TransportHealth = {
    healthy: true,
    consecutiveFailures: 0,
  };
  private metrics: TransportMetrics = {
    totalSends: 0,
    successfulSends: 0,
    failedSends: 0,
    avgLatency: 0,
    totalBytesSent: 0,
  };

  constructor(private readonly config: ResolvedLogsInterceptorConfig) {
    const transport = config.transport;
    this.exporter = new OTLPLogExporter({
      url: appendLogsPath(transport.url),
      headers: transport.headers,
      timeoutMillis: transport.timeout,
      concurrencyLimit: Math.max(1, config.performance.maxConcurrentFlushes),
      compression: transport.compression === 'gzip'
        ? CompressionAlgorithm.GZIP
        : CompressionAlgorithm.NONE,
      keepAlive: transport.enableConnectionPooling,
      httpAgentOptions: {
        keepAlive: transport.enableConnectionPooling,
        maxSockets: transport.maxSockets,
      },
      userAgent: 'elven-logs-interceptor/1.1.0',
    });
    this.resource = resourceFromAttributes({
      'service.name': config.appName,
      'service.version': config.version,
      'deployment.environment.name': config.environment,
      ...config.labels,
    });
  }

  async send(entries: LogEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const startedAt = performance.now();
    this.metrics.totalSends++;
    const records = entries.map((entry) => this.toReadableLogRecord(entry));

    try {
      await new Promise<void>((resolve, reject) => {
        this.exporter.export(records, (result) => {
          if (result.code === 0) {
            resolve();
            return;
          }
          reject(result.error ?? new Error('OTLP log export failed'));
        });
      });

      const duration = performance.now() - startedAt;
      const successfulSends = this.metrics.successfulSends + 1;
      this.metrics.avgLatency = (
        this.metrics.avgLatency * this.metrics.successfulSends + duration
      ) / successfulSends;
      this.metrics.successfulSends = successfulSends;
      this.metrics.totalBytesSent = (this.metrics.totalBytesSent ?? 0) + estimateSize(entries);
      this.health = {
        healthy: true,
        consecutiveFailures: 0,
        lastSuccessfulSend: Date.now(),
      };
    } catch (error) {
      this.metrics.failedSends++;
      this.health = {
        healthy: false,
        consecutiveFailures: this.health.consecutiveFailures + 1,
        lastSuccessfulSend: this.health.lastSuccessfulSend,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
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
    await this.exporter.shutdown();
  }

  private toReadableLogRecord(entry: LogEntry): ReadableLogRecord {
    const timestamp = toHrTime(entry.timestamp);
    const attributes: LogAttributes = {
      'log.record.id': entry.id,
      ...toAnyValueMap(entry.labels),
    };

    if (entry.context && Object.keys(entry.context).length > 0) {
      attributes['log.context'] = toAnyValue(entry.context);
    }
    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      attributes['log.metadata'] = toAnyValue(entry.metadata);
    }
    if (entry.requestId) {
      attributes['request.id'] = entry.requestId;
    }

    const spanContext = buildSpanContext(entry.traceId, entry.spanId);
    if (!spanContext && entry.traceId) attributes['trace.id'] = entry.traceId;
    if (!spanContext && entry.spanId) attributes['span.id'] = entry.spanId;

    return {
      hrTime: timestamp,
      hrTimeObserved: toHrTime(new Date().toISOString()),
      spanContext,
      severityText: entry.level.toUpperCase(),
      severityNumber: severityNumber(entry.level),
      body: entry.message,
      resource: this.resource,
      instrumentationScope,
      attributes,
      droppedAttributesCount: 0,
    };
  }
}

function appendLogsPath(rawUrl: string): string {
  const url = new URL(rawUrl);
  const basePath = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/v1\/(logs|metrics|traces)$/, '');
  url.pathname = `${basePath}/v1/logs`.replace(/\/+/g, '/');
  return url.toString();
}

function toHrTime(timestamp: string): [number, number] {
  const millis = Date.parse(timestamp);
  const safeMillis = Number.isFinite(millis) ? millis : Date.now();
  const seconds = Math.floor(safeMillis / 1_000);
  return [seconds, Math.floor((safeMillis - seconds * 1_000) * 1_000_000)];
}

function buildSpanContext(traceId?: string, spanId?: string) {
  if (!traceId || !spanId) return undefined;
  if (!/^[0-9a-f]{32}$/i.test(traceId) || !/^[0-9a-f]{16}$/i.test(spanId)) {
    return undefined;
  }

  return {
    traceId: traceId.toLowerCase(),
    spanId: spanId.toLowerCase(),
    traceFlags: TraceFlags.SAMPLED,
    isRemote: false,
  };
}

function severityNumber(level: LogEntry['level']): SeverityNumber {
  switch (level) {
    case 'debug': return SeverityNumber.DEBUG;
    case 'info': return SeverityNumber.INFO;
    case 'warn': return SeverityNumber.WARN;
    case 'error': return SeverityNumber.ERROR;
    case 'fatal': return SeverityNumber.FATAL;
  }
}

function toAnyValueMap(value: Record<string, unknown> | undefined): LogAttributes {
  if (!value) return {};
  return Object.entries(value).reduce<LogAttributes>((result, [key, item]) => {
    result[key] = toAnyValue(item);
    return result;
  }, {});
}

function toAnyValue(
  value: unknown,
  seen = new WeakSet<object>(),
  depth = 0
): AnyValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack ?? '' };
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    if (depth >= 8) return '[Max Depth Reached]';
    seen.add(value);
    if (Array.isArray(value)) {
      const result = value.map((item) => toAnyValue(item, seen, depth + 1));
      seen.delete(value);
      return result;
    }
    const result = Object.entries(value as Record<string, unknown>)
      .reduce<Record<string, AnyValue>>((mapped, [key, item]) => {
        mapped[key] = toAnyValue(item, seen, depth + 1);
        return mapped;
      }, {});
    seen.delete(value);
    return result;
  }
  return String(value);
}

function estimateSize(entries: LogEntry[]): number {
  try {
    return Buffer.byteLength(JSON.stringify(entries));
  } catch {
    return entries.reduce((total, entry) => total + Buffer.byteLength(entry.message), 0);
  }
}
