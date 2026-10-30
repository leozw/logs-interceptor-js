/**
 * Application Service: ConfigService
 * Handles configuration loading, validation, and resolution
 */
import { LogLevel } from '../../domain/value-objects/LogLevel';
import { validateMatcherPatterns } from '../../infrastructure/privacy/MatcherPolicy';
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
    const ranges: Array<[string, number | undefined, number, number]> = [
      ['transport.timeout', config.transport?.timeout, 1, 60_000],
      ['transport.maxRetries', config.transport?.maxRetries, 0, 5],
      ['transport.retryDelay', config.transport?.retryDelay, 0, 10_000],
      ['transport.maxWorkers', config.transport?.maxWorkers, 1, 16],
      ['transport.maxSockets', config.transport?.maxSockets, 1, 128],
      ['transport.workerTimeout', config.transport?.workerTimeout, 1, 60_000],
      ['buffer.maxSize', config.buffer?.maxSize, 1, 10_000],
      ['buffer.maxMemoryMB', config.buffer?.maxMemoryMB, 0.001, 4096],
      ['buffer.flushInterval', config.buffer?.flushInterval, 1, 3_600_000],
      ['buffer.maxAge', config.buffer?.maxAge, 1, 3_600_000],
      [
        'filter.maxMessageLength',
        config.filter?.maxMessageLength,
        1,
        1_048_576,
      ],
      ['filter.maxContextBytes', config.filter?.maxContextBytes, 1, 1_048_576],
      ['filter.samplingRate', config.filter?.samplingRate, 0, 1],
      [
        'performance.maxConcurrentFlushes',
        config.performance?.maxConcurrentFlushes,
        1,
        32,
      ],
      [
        'performance.maxPendingBatches',
        config.performance?.maxPendingBatches,
        1,
        64,
      ],
      ['performance.maxWorkers', config.performance?.maxWorkers, 1, 16],
      [
        'performance.workerTimeout',
        config.performance?.workerTimeout,
        1,
        60_000,
      ],
      ['deadLetterQueue.maxSize', config.deadLetterQueue?.maxSize, 1, 10_000],
      [
        'performance.shutdownTimeoutMillis',
        config.performance?.shutdownTimeoutMillis,
        1,
        60_000,
      ],
      [
        'deadLetterQueue.maxFileSizeMB',
        config.deadLetterQueue?.maxFileSizeMB,
        0.001,
        100,
      ],
    ];
    for (const [name, value, min, max] of ranges) {
      if (
        value !== undefined &&
        (!Number.isFinite(value) || value < min || value > max)
      ) {
        errors.push(`${name} must be finite and between ${min} and ${max}`);
      }
    }
    for (const [name, labels] of [
      ['labels', config.labels],
      ['dynamicLabels', config.dynamicLabels],
    ] as const) {
      if (
        labels &&
        (Object.keys(labels).length > 32 ||
          Object.keys(labels).some((key) => key.length > 128))
      ) {
        errors.push(
          `${name} must have at most 32 keys of at most 128 characters`,
        );
      }
    }
    for (const patterns of [
      config.filter?.patterns,
      config.filter?.sensitivePatterns,
    ]) {
      if (
        patterns &&
        (!Array.isArray(patterns) || patterns.length > 32 ||
          patterns.some(
            (pattern) =>
              !(pattern instanceof RegExp) ||
              pattern.source.length > 256,
          ))
      ) {
        errors.push(
          'Filter patterns must contain at most 32 RegExp inputs (256 characters each)',
        );
      }
    }
    if (
      (config.filter?.patterns && !validateMatcherPatterns(config.filter.patterns)) ||
      (config.filter?.sanitize !== false && config.filter?.sensitivePatterns && !validateMatcherPatterns(config.filter.sensitivePatterns))
    ) errors.push('ELVEN_MATCHER_UNSUPPORTED_PATTERN');

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

    if (
      (config.transport?.type ?? 'loki') === 'loki' &&
      !config.transport?.tenantId
    ) {
      errors.push('Tenant ID is required');
    }

    if (!config.appName) {
      errors.push('App name is required');
    }

    for (const rawUrl of [config.transport?.url, config.transport?.logsUrl]) {
      if (rawUrl) {
        try {
          // eslint-disable-next-line no-new
          const url = new URL(rawUrl);
          if (
            !['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password
          ) {
            errors.push(
              'Transport URL must use HTTP(S) without embedded credentials',
            );
          }
        } catch {
          errors.push('Transport URL must be a valid URL');
        }
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

    if (config.buffer?.maxSize !== undefined && config.buffer.maxSize <= 0) {
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
    performance?: PerformanceConfig,
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
      logsUrl: transport?.logsUrl ?? '',
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
      workerTimeout:
        transport?.workerTimeout ?? performance?.workerTimeout ?? 30_000,
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
      sensitivePatterns: filter?.sensitivePatterns ?? [
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
    circuitBreaker?: CircuitBreakerConfig,
  ): Required<CircuitBreakerConfig> {
    return {
      enabled: circuitBreaker?.enabled ?? true,
      failureThreshold: circuitBreaker?.failureThreshold ?? 50,
      resetTimeout: circuitBreaker?.resetTimeout ?? 30_000,
      halfOpenRequests: circuitBreaker?.halfOpenRequests ?? 3,
    };
  }

  private static resolvePerformance(
    performance?: PerformanceConfig,
  ): Required<Omit<PerformanceConfig, 'maxWorkers'>> & { maxWorkers?: number } {
    return {
      useWorkers: performance?.useWorkers ?? false,
      maxConcurrentFlushes: performance?.maxConcurrentFlushes ?? 2,
      maxPendingBatches: performance?.maxPendingBatches ?? 2,
      compressionLevel: performance?.compressionLevel ?? 6,
      maxWorkers: performance?.maxWorkers,
      workerTimeout: performance?.workerTimeout ?? 30_000,
      shutdownTimeoutMillis: performance?.shutdownTimeoutMillis ?? 10_000,
    };
  }
}
