import type { LogLevel } from '../value-objects/LogLevel';

/**
 * Main logger interface
 * Follows Interface Segregation Principle
 */
export interface ILogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  fatal(message: string, context?: Record<string, unknown>): void;
  log(level: LogLevel, message: string, context?: Record<string, unknown>): void;
  trackEvent(eventName: string, properties?: Record<string, unknown>): void;
  withContext<T>(context: Record<string, unknown>, fn: () => T): T;
  withContextAsync<T>(
    context: Record<string, unknown>,
    fn: () => Promise<T>
  ): Promise<T>;
  flush(): Promise<void>;
  getMetrics(): LoggerMetrics;
  getHealth(): HealthStatus;
  destroy(): Promise<void>;
}

export interface LoggerMetrics {
  readonly logsProcessed: number;
  readonly logsDropped: number;
  readonly logsSanitized: number;
  readonly flushCount: number;
  readonly errorCount: number;
  readonly bufferSize: number;
  readonly avgFlushTime: number;
  readonly lastFlushTime: number;
  readonly memoryUsage: number;
  readonly cpuUsage: number;
  readonly circuitBreakerTrips: number;
  readonly droppedByBackpressure: number;
  readonly droppedByDlq: number;
  readonly pendingFlushBatches: number;
  readonly inFlightFlushes: number;
  readonly latency?: {
    readonly p50: number;
    readonly p95: number;
    readonly p99: number;
    readonly avg: number;
  };
  readonly compression?: {
    readonly avgRatio: number;
    readonly avgTime: number;
    readonly totalSavedBytes: number;
  };
  readonly throughput?: number; // logs per second
}

export interface HealthStatus {
  readonly healthy: boolean;
  readonly lastSuccessfulFlush: number;
  readonly consecutiveErrors: number;
  readonly bufferUtilization: number;
  uptime: number;
  memoryUsageMB: number;
  circuitBreakerState: 'closed' | 'open' | 'half-open';
  lastError?: string;
}
