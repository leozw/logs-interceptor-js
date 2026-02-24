/**
 * Application Service: LogService
 * Orchestrates log processing
 */
import { trace } from '@opentelemetry/api';
import * as os from 'os';
import { performance } from 'perf_hooks';
import { LogEntryEntity } from '../../domain/entities/LogEntry';
import { IContextProvider } from '../../domain/interfaces/IContextProvider';
import { ILogBuffer } from '../../domain/interfaces/ILogBuffer';
import { ILogFilter } from '../../domain/interfaces/ILogFilter';
import {
  HealthStatus,
  ILogger,
  LoggerMetrics,
} from '../../domain/interfaces/ILogger';
import { ILogTransport } from '../../domain/interfaces/ILogTransport';
import type { LogLevel } from '../../domain/value-objects/LogLevel';
import { MetricsCollector } from '../../infrastructure/metrics/MetricsCollector';

interface FlushTask {
  entries: LogEntryEntity[];
  resolve: () => void;
  reject: (error: Error) => void;
}

export class LogService implements ILogger {
  private metrics: {
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
    droppedByBackpressure: number;
    droppedByDlq: number;
  };
  private startTime: number;
  private metricsCollector: MetricsCollector;
  private readonly hostname: string;
  private readonly pid: string;
  private readonly maxConcurrentFlushes: number;

  private destroyed = false;
  private logSequence = 0;
  private lastResourceSampleAt = 0;
  private readonly resourceSampleIntervalMs = 1000;

  private readonly flushQueue: FlushTask[] = [];
  private inFlightFlushes = 0;
  private idleResolvers: Array<() => void> = [];

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
      enableMetrics: boolean;
      maxConcurrentFlushes: number;
    }
  ) {
    this.startTime = Date.now();
    this.hostname = os.hostname();
    this.pid = String(process.pid);
    this.maxConcurrentFlushes = Math.max(1, config.maxConcurrentFlushes);
    this.metrics = this.initializeMetrics();
    this.metricsCollector = new MetricsCollector();

    if (
      'setFlushCallback' in buffer &&
      typeof (buffer as any).setFlushCallback === 'function'
    ) {
      (buffer as any).setFlushCallback(() => {
        void this.flush();
      });
    }
  }

  private initializeMetrics() {
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
      droppedByBackpressure: 0,
      droppedByDlq: 0,
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
    void this.flush().catch(() => {
      // ignore fatal flush errors to avoid process-level unhandled rejection
    });
  }

  withContext<T>(context: Record<string, unknown>, fn: () => T): T {
    return this.contextProvider.runWithContext(context, fn);
  }

  withContextAsync<T>(
    context: Record<string, unknown>,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.contextProvider.runWithContextAsync(context, fn);
  }

  log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (this.destroyed) {
      this.metrics.logsDropped++;
      return;
    }

    if (!this.filter.isLevelEnabled(level)) {
      return;
    }

    const entry = this.createLogEntry(level, message, context);

    if (!this.filter.shouldProcess(entry)) {
      this.metrics.logsDropped++;
      return;
    }

    const filteredEntry = this.filter.filter(entry);
    if (
      filteredEntry.message !== entry.message ||
      filteredEntry.context !== entry.context
    ) {
      this.metrics.logsSanitized++;
    }

    this.buffer.add(filteredEntry);
    this.metrics.logsProcessed++;
    this.updateMetrics();
  }

  trackEvent(eventName: string, properties?: Record<string, unknown>): void {
    this.info(`[EVENT] ${eventName}`, properties);
  }

  private createLogEntry(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>
  ): LogEntryEntity {
    const asyncContext = this.contextProvider.getContext();
    const logId = `${Date.now().toString(36)}-${(this.logSequence++).toString(36)}`;

    const dynamicLabels = Object.entries(this.config.dynamicLabels).reduce(
      (acc, [key, fn]) => {
        try {
          const value = String(fn());
          if (value && value !== 'undefined' && value !== '') {
            acc[key] = value;
          }
        } catch {
          // skip failing label provider
        }
        return acc;
      },
      {} as Record<string, string>
    );

    const spanContext = trace.getActiveSpan()?.spanContext();
    const traceId = spanContext?.traceId || (dynamicLabels.trace_id as string);
    const spanId = spanContext?.spanId || (dynamicLabels.span_id as string);

    return new LogEntryEntity(
      logId,
      new Date().toISOString(),
      level,
      message,
      {
        ...asyncContext,
        ...context,
      },
      traceId,
      spanId,
      dynamicLabels.request_id,
      {
        app: this.config.appName,
        version: this.config.version,
        environment: this.config.environment,
        level,
        hostname: this.hostname,
        pid: this.pid,
        ...this.config.labels,
        ...dynamicLabels,
      },
      {
        memoryUsage: this.metrics.memoryUsage,
        cpuUsage: this.metrics.cpuUsage,
      }
    );
  }

  async flush(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    if (this.buffer.size() > 0) {
      const entries = this.buffer.flush() as LogEntryEntity[];
      if (entries.length > 0) {
        await this.enqueueFlush(entries);
      }
    }

    if (this.inFlightFlushes > 0 || this.flushQueue.length > 0) {
      await this.waitForQueueIdle();
    }
  }

  private enqueueFlush(entries: LogEntryEntity[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.flushQueue.push({ entries, resolve, reject });
      this.processFlushQueue();
    });
  }

  private processFlushQueue(): void {
    while (
      this.inFlightFlushes < this.maxConcurrentFlushes &&
      this.flushQueue.length > 0
    ) {
      const task = this.flushQueue.shift();
      if (!task) {
        break;
      }

      this.inFlightFlushes++;

      void this.sendFlushBatch(task)
        .catch((error) => {
          task.reject(error as Error);
        })
        .finally(() => {
          this.inFlightFlushes = Math.max(0, this.inFlightFlushes - 1);
          this.processFlushQueue();
          this.notifyIfQueueIdle();
        });
    }
  }

  private async sendFlushBatch(task: FlushTask): Promise<void> {
    const startTime = performance.now();

    try {
      await this.transport.send(task.entries);
      const flushTime = performance.now() - startTime;

      this.metricsCollector.recordLatency(flushTime);
      this.metrics.flushCount++;
      this.metrics.lastFlushTime = Date.now();
      this.metrics.avgFlushTime =
        (this.metrics.avgFlushTime * (this.metrics.flushCount - 1) + flushTime) /
        this.metrics.flushCount;

      this.updateMetrics();
      task.resolve();
    } catch (error) {
      this.metrics.errorCount++;
      task.reject(error as Error);
    }
  }

  private notifyIfQueueIdle(): void {
    if (this.inFlightFlushes !== 0 || this.flushQueue.length !== 0) {
      return;
    }

    const resolvers = [...this.idleResolvers];
    this.idleResolvers = [];
    resolvers.forEach((resolve) => resolve());
  }

  private waitForQueueIdle(): Promise<void> {
    if (this.inFlightFlushes === 0 && this.flushQueue.length === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  getMetrics(): LoggerMetrics {
    this.updateMetrics(true);

    const latencyMetrics = this.metricsCollector.getLatencyMetrics();
    const compressionMetrics = this.metricsCollector.getCompressionMetrics();

    return {
      ...this.metrics,
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

    let circuitBreakerState: 'closed' | 'open' | 'half-open' = 'closed';
    if (!transportHealth.healthy) {
      circuitBreakerState = 'open';
    } else if (transportHealth.errorMessage?.includes('HALF_OPEN')) {
      circuitBreakerState = 'half-open';
    }

    return {
      healthy: this.metrics.errorCount < 10 && transportHealth.healthy,
      lastSuccessfulFlush: this.metrics.lastFlushTime,
      consecutiveErrors: this.metrics.errorCount,
      bufferUtilization:
        bufferMetrics.maxSize > 0
          ? bufferMetrics.size / bufferMetrics.maxSize
          : 0,
      uptime: Date.now() - this.startTime,
      memoryUsageMB: this.metrics.memoryUsage,
      circuitBreakerState,
      lastError: transportHealth.errorMessage,
    };
  }

  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;

    let flushError: Error | undefined;

    try {
      if (this.buffer.size() > 0) {
        const entries = this.buffer.flush() as LogEntryEntity[];
        if (entries.length > 0) {
          await this.enqueueFlush(entries);
        }
      }

      await this.waitForQueueIdle();
    } catch (error) {
      flushError = error as Error;
    } finally {
      this.buffer.destroy();
      await this.transport.destroy();
    }

    if (flushError) {
      throw flushError;
    }
  }

  private updateMetrics(force: boolean = false): void {
    if (!this.config.enableMetrics) return;

    const now = Date.now();
    if (!force && now - this.lastResourceSampleAt < this.resourceSampleIntervalMs) {
      this.metrics.bufferSize = this.buffer.size();
      return;
    }

    this.lastResourceSampleAt = now;

    const memUsage = process.memoryUsage();
    this.metrics.memoryUsage = memUsage.heapUsed / 1024 / 1024;
    this.metrics.cpuUsage = process.cpuUsage().user / 1_000_000;

    const bufferMetrics = this.buffer.getMetrics();
    this.metrics.bufferSize = bufferMetrics.size;
    this.metrics.droppedByBackpressure = bufferMetrics.droppedEntries;

    const transportMetrics = this.transport.getMetrics?.();
    this.metrics.droppedByDlq = transportMetrics?.dlqDroppedEntries || 0;
  }
}
