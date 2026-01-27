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
  TransportConfig
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

    if (!config.transport?.tenantId) {
      errors.push('Tenant ID is required');
    }

    if (!config.appName) {
      errors.push('App name is required');
    }

    if (config.transport?.url) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const url = new URL(config.transport.url);
      } catch {
        errors.push('Transport URL must be a valid URL');
      }
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

    if (config.filter?.samplingRate !== undefined) {
      const rate = config.filter.samplingRate;
      if (rate < 0 || rate > 1) {
        errors.push('Sampling rate must be between 0 and 1');
      }
    }

    return errors;
  }

  /**
   * Resolve configuration with defaults
   */
  static resolve(config: LogsInterceptorConfig): ResolvedLogsInterceptorConfig {
    return {
      transport: this.resolveTransport(config.transport),
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
    transport?: TransportConfig
  ): ResolvedLogsInterceptorConfig['transport'] {
    // Normalize compression type
    // Normalize compression type
    let compression: 'none' | 'gzip' | 'brotli' | 'snappy' = 'gzip';
    if (transport?.compression === false || transport?.compression === 'none') {
      compression = 'none';
    } else if (transport?.compression === 'brotli') {
      compression = 'brotli';
    } else if (transport?.compression === 'snappy') {
      compression = 'snappy';
    } else if (transport?.compression === 'gzip' || transport?.compression === true) {
      compression = 'gzip';
    }

    return {
      url: transport?.url ?? '',
      tenantId: transport?.tenantId ?? '',
      authToken: transport?.authToken ?? '',
      timeout: transport?.timeout ?? 5000,
      maxRetries: transport?.maxRetries ?? 3,
      retryDelay: transport?.retryDelay ?? 1000,
      compression,
      compressionLevel: transport?.compressionLevel ?? 6,
      compressionThreshold: transport?.compressionThreshold ?? 1024,
      useWorkers: transport?.useWorkers ?? true,
      maxWorkers: transport?.maxWorkers,
      enableConnectionPooling: transport?.enableConnectionPooling ?? true,
      maxSockets: transport?.maxSockets ?? 50,
    };
  }

  private static resolveBuffer(buffer?: BufferConfig): Required<BufferConfig> {
    return {
      maxSize: buffer?.maxSize ?? 100,
      flushInterval: buffer?.flushInterval ?? 5000,
      maxAge: buffer?.maxAge ?? 30000,
      autoFlush: buffer?.autoFlush ?? true,
      maxMemoryMB: buffer?.maxMemoryMB ?? 50,
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
      failureThreshold: circuitBreaker?.failureThreshold ?? 5,
      resetTimeout: circuitBreaker?.resetTimeout ?? 60000,
      halfOpenRequests: circuitBreaker?.halfOpenRequests ?? 3,
    };
  }

  private static resolvePerformance(
    performance?: PerformanceConfig
  ): Required<Omit<PerformanceConfig, 'maxWorkers'>> & { maxWorkers?: number } {
    return {
      useWorkers: performance?.useWorkers ?? true,
      maxConcurrentFlushes: performance?.maxConcurrentFlushes ?? 3,
      compressionLevel: performance?.compressionLevel ?? 6,
      maxWorkers: performance?.maxWorkers,
      workerTimeout: performance?.workerTimeout ?? 30000,
    };
  }
}



