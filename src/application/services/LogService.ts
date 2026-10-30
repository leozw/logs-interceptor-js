/**
 * Application Service: LogService
 * Orchestrates log processing
 */
import { trace } from '@opentelemetry/api';
import * as crypto from 'crypto';
import * as os from 'os';
import { performance } from 'perf_hooks';
import { LogEntryEntity } from '../../domain/entities/LogEntry';
import { IContextProvider } from '../../domain/interfaces/IContextProvider';
import { ILogBuffer } from '../../domain/interfaces/ILogBuffer';
import { ILogFilter } from '../../domain/interfaces/ILogFilter';
import { HealthStatus, ILogger, LoggerMetrics } from '../../domain/interfaces/ILogger';
import { ILogTransport } from '../../domain/interfaces/ILogTransport';
import type { LogLevel } from '../../domain/value-objects/LogLevel';
import { LogLevelVO } from '../../domain/value-objects/LogLevel';
import { MetricsCollector } from '../../infrastructure/metrics/MetricsCollector';
import { boundedSnapshot } from '../../infrastructure/memory/BoundedSnapshot';
import type { MatcherExecution } from '../../infrastructure/privacy/MatcherPolicy';

export class LogService implements ILogger {
  private metrics: LoggerMetrics & {
    logsProcessed: number;
    logsDropped: number;
    logsSanitized: number;
    flushCount: number;
    errorCount: number;
    bufferSize: number;
    avgFlushTime: number;
    lastFlushTime: number;
    memoryUsage: number;
    cpuUsage: number;
    circuitBreakerTrips: number;
  };
  private startTime: number;
  private metricsCollector: MetricsCollector;
  private pendingFlush?: Promise<void>;
  private closing = false;
  private destroyPromise?: Promise<void>;

  constructor(
    private readonly filter: ILogFilter,
    private readonly buffer: ILogBuffer,
    private readonly transport: ILogTransport,
    private readonly contextProvider: IContextProvider,
    private readonly config: {
      appName: string;
      version: string;
      environment: string;
      labels: Record<string, string>;
      dynamicLabels: Record<string, () => string | number>;
      indexCorrelationIds?: boolean;
      enableMetrics: boolean;
    }
  ) {
    this.startTime = Date.now();
    this.metrics = this.initializeMetrics();
    this.metricsCollector = new MetricsCollector();

    // Setup automatic flush callback if buffer supports it
    if ('setFlushCallback' in buffer && typeof (buffer as any).setFlushCallback === 'function') {
      (buffer as any).setFlushCallback(() => {
        this.flush().catch(() => {
          // Silent fail for scheduled flushes to avoid infinite loops
        });
      });
    }
  }

  private initializeMetrics(): LoggerMetrics {
    return {
      logsProcessed: 0,
      logsDropped: 0,
      logsSanitized: 0,
      flushCount: 0,
      errorCount: 0,
      bufferSize: 0,
      avgFlushTime: 0,
      lastFlushTime: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      circuitBreakerTrips: 0,
    };
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    this.log('fatal', message, context);
    // Force immediate flush for fatal errors
    this.flush().catch(() => {
      // Silent fail for fatal errors
    });
  }

  log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (this.closing) return;
    if (!this.filter.isLevelEnabled(level)) {
      return;
    }

    let execution: MatcherExecution | undefined;
    try {
      execution = this.filter.beginRecord?.();
      const entry = this.createLogEntry(level, message, context);
      const filteredEntry = this.filter.filter(entry, execution);
      if (!this.filter.shouldProcess(filteredEntry, execution)) {
        this.metrics.logsDropped++;
        return;
      }
      this.buffer.add(filteredEntry);
      this.metrics.logsProcessed++;
      this.updateMetrics();
    } catch {
      this.metrics.logsDropped++;
      this.metrics.errorCount++;
    } finally {
      try { execution?.close(); } catch { this.metrics.errorCount++; }
    }
  }

  trackEvent(eventName: string, properties?: Record<string, unknown>): void {
    this.info(`[EVENT] ${eventName}`, properties);
  }



  private createLogEntry(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>
  ): LogEntryEntity {
    const levelVO = new LogLevelVO(level);
    const asyncContext = this.contextProvider.getContext();
    const logId = crypto.randomBytes(8).toString('hex');

    // Compute dynamic labels - only include if not empty
    const dynamicLabels = Object.entries(this.config.dynamicLabels).reduce(
      (acc, [key, fn]) => {
        try {
          const value = String(fn());
          // Only add label if value is not empty or 'undefined'
          if (value && value !== 'undefined' && value !== '') {
            acc[key] = value;
          }
        } catch (error) {
          // Skip labels that fail to compute
        }
        return acc;
      },
      {} as Record<string, string>
    );

    // 🔥 AUTOMATIC TRACE CORRELATION
    const spanContext = trace.getActiveSpan()?.spanContext();
    const traceId = spanContext?.traceId || (dynamicLabels.trace_id as string);
    const spanId = spanContext?.spanId || (dynamicLabels.span_id as string);
    const labels: Record<string, string> = {
      app: this.config.appName,
      version: this.config.version,
      environment: this.config.environment,
      level,
      hostname: os.hostname(),
      pid: String(process.pid),
      ...this.config.labels,
      ...(this.config.indexCorrelationIds === false
        ? Object.fromEntries(Object.entries(dynamicLabels).filter(([key]) => !['trace_id', 'span_id', 'request_id'].includes(key)))
        : dynamicLabels),
    };

    return new LogEntryEntity(
      logId,
      new Date().toISOString(),
      level,
      message,
      {
        ...boundedSnapshot(asyncContext) as Record<string, unknown>,
        ...boundedSnapshot(context) as Record<string, unknown>,
      },
      traceId,
      spanId,
      dynamicLabels.request_id,
      labels,
      {
        memoryUsage: this.metrics.memoryUsage,
        cpuUsage: this.metrics.cpuUsage,
      }
    );
  }

  async flush(): Promise<void> {
    if (this.pendingFlush) return this.pendingFlush;
    this.pendingFlush = this.flushBatch().finally(() => { this.pendingFlush = undefined; });
    return this.pendingFlush;
  }

  private async flushBatch(): Promise<void> {
    if (this.buffer.size() === 0) {
      return;
    }

    const entries = this.buffer.flush();
    const startTime = performance.now();

    try {
      await this.transport.send(entries);
      const flushTime = performance.now() - startTime;

      // Record latency for advanced metrics
      this.metricsCollector.recordLatency(flushTime);

      this.metrics.flushCount++;
      this.metrics.lastFlushTime = Date.now();
      this.metrics.avgFlushTime =
        (this.metrics.avgFlushTime * (this.metrics.flushCount - 1) + flushTime) /
        this.metrics.flushCount;
      this.updateMetrics();

      // Buffer will automatically re-schedule flush after successful flush
    } catch (error) {
      this.metrics.errorCount++;
      // Do not re-add to buffer; rely on Transport resilience (DLQ/Retry)
      throw error;
    }
  }

  getMetrics(): LoggerMetrics {
    const latencyMetrics = this.metricsCollector.getLatencyMetrics();
    const compressionMetrics = this.metricsCollector.getCompressionMetrics();

    // Get transport metrics if available
    const transportMetrics = (this.transport as any).getMetrics?.();
    const bufferDrops = this.buffer.getMetrics().droppedEntries ?? 0;

    return {
      ...this.metrics,
      logsDropped: Math.min(Number.MAX_SAFE_INTEGER, this.metrics.logsDropped + bufferDrops),
      bufferSize: this.buffer.size(),
      latency: {
        p50: latencyMetrics.p50,
        p95: latencyMetrics.p95,
        p99: latencyMetrics.p99,
        avg: latencyMetrics.avg,
      },
      compression: {
        avgRatio: compressionMetrics.avgRatio,
        avgTime: compressionMetrics.avgTime,
        totalSavedBytes: compressionMetrics.totalSavedBytes,
      },
      throughput: this.metricsCollector.getThroughput(60),
    };
  }

  getHealth(): HealthStatus {
    const bufferMetrics = this.buffer.getMetrics();
    const transportHealth = this.transport.getHealth();
    const privacyCodes = this.filter.privacyDiagnostics?.() ?? [];

    return {
      healthy:
        this.metrics.errorCount < 10 &&
        privacyCodes.length === 0 &&
        transportHealth.healthy,
      lastSuccessfulFlush: this.metrics.lastFlushTime,
      consecutiveErrors: this.metrics.errorCount,
      bufferUtilization: bufferMetrics.size / bufferMetrics.maxSize,
      uptime: Date.now() - this.startTime,
      memoryUsageMB: this.metrics.memoryUsage,
      circuitBreakerState: transportHealth.healthy ? 'closed' : 'open',
      lastError: transportHealth.errorMessage,
      privacyCodes,
    };
  }

  async destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    this.closing = true;
    this.destroyPromise = (async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          (async () => { await this.flush(); await this.flush(); })(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Legacy log drain deadline exceeded')), 5000); }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
        this.buffer.clear();
        try { await this.transport.destroy(); } finally { this.filter.close?.(); }
      }
    })();
    return this.destroyPromise;
  }

  private updateMetrics(): void {
    if (!this.config.enableMetrics) return;

    const memUsage = process.memoryUsage();
    this.metrics.memoryUsage = memUsage.heapUsed / 1024 / 1024;
    this.metrics.cpuUsage = process.cpuUsage().user / 1000000;
    this.metrics.bufferSize = this.buffer.size();
  }
}

