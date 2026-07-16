/**
 * Application Service: ConfigService
 * Handles configuration loading, validation, and resolution
 */
import { LogLevel } from '../../domain/value-objects/LogLevel';
import {
  BufferConfig,
  CircuitBreakerConfig,
  FilterConfig,
  LogsInterceptorConfig,
  PerformanceConfig,
  ResolvedLogsInterceptorConfig,
  TransportConfig,
} from '../config/LogsInterceptorConfig';

export class ConfigService {
  /**
   * Validate configuration
   */
  static validate(config: Partial<LogsInterceptorConfig>): string[] {
    const errors: string[] = [];

    if (!config.transport?.url) {
      errors.push('Transport URL is required');
    }

    if (
      config.transport?.type !== undefined &&
      config.transport.type !== 'loki' &&
      config.transport.type !== 'otlp'
    ) {
      errors.push('Transport type must be either loki or otlp');
    }

    if ((config.transport?.type ?? 'loki') === 'loki' && !config.transport?.tenantId) {
      errors.push('Tenant ID is required');
    }

    if (!config.appName) {
      errors.push('App name is required');
    }

    if (config.transport?.url) {
      try {
        // eslint-disable-next-line no-new
        new URL(config.transport.url);
      } catch {
        errors.push('Transport URL must be a valid URL');
      }
    }

    if (
      config.transport?.timeout !== undefined &&
      config.transport.timeout < 0
    ) {
      errors.push('Transport timeout must be greater than or equal to 0');
    }

    if (
      config.transport?.maxRetries !== undefined &&
      config.transport.maxRetries < 0
    ) {
      errors.push('Transport max retries must be greater than or equal to 0');
    }

    if (
      config.transport?.retryDelay !== undefined &&
      config.transport.retryDelay < 0
    ) {
      errors.push('Transport retry delay must be greater than or equal to 0');
    }

    if (
      config.buffer?.maxSize !== undefined &&
      config.buffer.maxSize <= 0
    ) {
      errors.push('Buffer max size must be greater than 0');
    }

    if (
      config.buffer?.flushInterval !== undefined &&
      config.buffer.flushInterval <= 0
    ) {
      errors.push('Flush interval must be greater than 0');
    }

    if (
      config.buffer?.maxMemoryMB !== undefined &&
      config.buffer.maxMemoryMB <= 0
    ) {
      errors.push('Buffer max memory must be greater than 0');
    }

    if (config.filter?.samplingRate !== undefined) {
      const rate = config.filter.samplingRate;
      if (rate < 0 || rate > 1) {
        errors.push('Sampling rate must be between 0 and 1');
      }
    }

    if (
      config.circuitBreaker?.failureThreshold !== undefined &&
      config.circuitBreaker.failureThreshold <= 0
    ) {
      errors.push('Circuit breaker failure threshold must be greater than 0');
    }

    if (
      config.circuitBreaker?.resetTimeout !== undefined &&
      config.circuitBreaker.resetTimeout <= 0
    ) {
      errors.push('Circuit breaker reset timeout must be greater than 0');
    }

    if (
      config.circuitBreaker?.halfOpenRequests !== undefined &&
      config.circuitBreaker.halfOpenRequests <= 0
    ) {
      errors.push('Circuit breaker half-open requests must be greater than 0');
    }

    if (
      config.performance?.maxConcurrentFlushes !== undefined &&
      config.performance.maxConcurrentFlushes <= 0
    ) {
      errors.push('Max concurrent flushes must be greater than 0');
    }

    if (
      config.performance?.maxPendingBatches !== undefined &&
      config.performance.maxPendingBatches <= 0
    ) {
      errors.push('Max pending batches must be greater than 0');
    }

    if (
      config.filter?.maxContextBytes !== undefined &&
      config.filter.maxContextBytes <= 0
    ) {
      errors.push('Max context bytes must be greater than 0');
    }

    if (
      config.transport?.compressionLevel !== undefined &&
      config.transport.compressionLevel < 0
    ) {
      errors.push('Compression level must be greater than or equal to 0');
    }

    return errors;
  }

  /**
   * Resolve configuration with defaults
   */
  static resolve(config: LogsInterceptorConfig): ResolvedLogsInterceptorConfig {
    return {
      transport: this.resolveTransport(config.transport, config.performance),
      appName: config.appName,
      version: config.version ?? '1.0.0',
      environment: config.environment ?? 'production',
      labels: config.labels ?? {},
      dynamicLabels: config.dynamicLabels ?? {},
      buffer: this.resolveBuffer(config.buffer),
      filter: this.resolveFilter(config.filter),
      circuitBreaker: this.resolveCircuitBreaker(config.circuitBreaker),
      integrations: config.integrations ?? {},
      performance: this.resolvePerformance(config.performance),
      deadLetterQueue: config.deadLetterQueue,
      enableMetrics: config.enableMetrics ?? true,
      enableHealthCheck: config.enableHealthCheck ?? true,
      interceptConsole: config.interceptConsole ?? false,
      preserveOriginalConsole: config.preserveOriginalConsole ?? true,
      debug: config.debug ?? false,
      silentErrors: config.silentErrors ?? false,
    };
  }

  private static resolveTransport(
    transport?: TransportConfig,
    performance?: PerformanceConfig
  ): ResolvedLogsInterceptorConfig['transport'] {
    let compression: 'none' | 'gzip' | 'brotli' | 'snappy' = 'gzip';
    if (transport?.compression === false || transport?.compression === 'none') {
      compression = 'none';
    } else if (transport?.compression === 'brotli') {
      compression = 'brotli';
    } else if (transport?.compression === 'snappy') {
      compression = 'snappy';
    } else if (
      transport?.compression === 'gzip' ||
      transport?.compression === true
    ) {
      compression = 'gzip';
    }

    return {
      type: transport?.type ?? 'loki',
      url: transport?.url ?? '',
      tenantId: transport?.tenantId ?? '',
      authToken: transport?.authToken ?? '',
      headers: transport?.headers ?? {},
      timeout: transport?.timeout ?? 5_000,
      maxRetries: transport?.maxRetries ?? 1,
      retryDelay: transport?.retryDelay ?? 1_000,
      compression,
      compressionLevel:
        transport?.compressionLevel ?? performance?.compressionLevel ?? 6,
      compressionThreshold: transport?.compressionThreshold ?? 1024,
      useWorkers: transport?.useWorkers ?? performance?.useWorkers ?? false,
      maxWorkers: transport?.maxWorkers ?? performance?.maxWorkers,
      workerTimeout: transport?.workerTimeout ?? performance?.workerTimeout ?? 30_000,
      enableConnectionPooling: transport?.enableConnectionPooling ?? true,
      maxSockets: transport?.maxSockets ?? 10,
    };
  }

  private static resolveBuffer(buffer?: BufferConfig): Required<BufferConfig> {
    return {
      maxSize: buffer?.maxSize ?? 100,
      flushInterval: buffer?.flushInterval ?? 5_000,
      maxAge: buffer?.maxAge ?? 30_000,
      autoFlush: buffer?.autoFlush ?? true,
      maxMemoryMB: buffer?.maxMemoryMB ?? 32,
    };
  }

  private static resolveFilter(filter?: FilterConfig): Required<FilterConfig> {
    return {
      levels:
        filter?.levels ??
        (['debug', 'info', 'warn', 'error', 'fatal'] as LogLevel[]),
      patterns: filter?.patterns ?? [],
      samplingRate: filter?.samplingRate ?? 1.0,
      maxMessageLength: filter?.maxMessageLength ?? 8192,
      maxContextBytes: filter?.maxContextBytes ?? 16_384,
      sanitize: filter?.sanitize ?? true,
      sensitivePatterns:
        filter?.sensitivePatterns ??
        [
          /password/i,
          /token/i,
          /secret/i,
          /api[_-]?key/i,
          /authorization/i,
          /credit[_-]?card/i,
          /ssn/i,
          /cpf/i,
        ],
    };
  }

  private static resolveCircuitBreaker(
    circuitBreaker?: CircuitBreakerConfig
  ): Required<CircuitBreakerConfig> {
    return {
      enabled: circuitBreaker?.enabled ?? true,
      failureThreshold: circuitBreaker?.failureThreshold ?? 50,
      resetTimeout: circuitBreaker?.resetTimeout ?? 30_000,
      halfOpenRequests: circuitBreaker?.halfOpenRequests ?? 3,
    };
  }

  private static resolvePerformance(
    performance?: PerformanceConfig
  ): Required<Omit<PerformanceConfig, 'maxWorkers'>> & { maxWorkers?: number } {
    return {
      useWorkers: performance?.useWorkers ?? false,
      maxConcurrentFlushes: performance?.maxConcurrentFlushes ?? 2,
      maxPendingBatches: performance?.maxPendingBatches ?? 2,
      compressionLevel: performance?.compressionLevel ?? 6,
      maxWorkers: performance?.maxWorkers,
      workerTimeout: performance?.workerTimeout ?? 30_000,
    };
  }
}
