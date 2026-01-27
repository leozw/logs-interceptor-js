/**
 * Application Configuration
 * DTOs for configuration
 */
import { LogLevel } from '../../domain/value-objects/LogLevel';

export interface TransportConfig {
  readonly url: string;
  readonly tenantId: string;
  readonly authToken?: string;
  readonly timeout?: number;
  readonly maxRetries?: number;
  readonly retryDelay?: number;
  readonly compression?: 'none' | 'gzip' | 'brotli' | 'snappy' | boolean; // boolean for backward compat
  readonly compressionLevel?: number;
  readonly compressionThreshold?: number; // bytes - only compress if larger
  readonly useWorkers?: boolean;
  readonly maxWorkers?: number;
  readonly enableConnectionPooling?: boolean;
  readonly maxSockets?: number;
}

export interface BufferConfig {
  readonly maxSize?: number;
  readonly flushInterval?: number;
  readonly maxAge?: number;
  readonly autoFlush?: boolean;
  readonly maxMemoryMB?: number;
}

export interface FilterConfig {
  readonly levels?: LogLevel[];
  readonly patterns?: RegExp[];
  readonly samplingRate?: number;
  readonly maxMessageLength?: number;
  readonly sanitize?: boolean;
  readonly sensitivePatterns?: RegExp[];
}

export interface CircuitBreakerConfig {
  readonly enabled?: boolean;
  readonly failureThreshold?: number;
  readonly resetTimeout?: number;
  readonly halfOpenRequests?: number;
}

export interface IntegrationsConfig {
  readonly winston?: boolean | WinstonIntegrationConfig;
  readonly pino?: boolean | PinoIntegrationConfig;
  readonly morgan?: boolean | MorganIntegrationConfig;
  readonly nodeRed?: boolean | NodeRedIntegrationConfig;
}

export interface WinstonIntegrationConfig {
  readonly enabled: boolean;
  readonly levels?: Record<string, LogLevel>;
}

export interface PinoIntegrationConfig {
  readonly enabled: boolean;
  readonly messageKey?: string;
  readonly levelKey?: string;
}

export interface MorganIntegrationConfig {
  readonly enabled: boolean;
  readonly format?: string;
}

export interface NodeRedIntegrationConfig {
  readonly enabled: boolean;
  readonly nodeName?: string;
  readonly category?: string;
}

export interface PerformanceConfig {
  readonly useWorkers?: boolean;
  readonly maxConcurrentFlushes?: number;
  readonly compressionLevel?: number;
  readonly maxWorkers?: number;
  readonly workerTimeout?: number;
}

export interface DeadLetterQueueConfig {
  readonly enabled?: boolean;
  readonly type?: 'memory' | 'file';
  readonly maxSize?: number;
  readonly maxRetries?: number;
  readonly basePath?: string;
}

export interface LogsInterceptorConfig {
  readonly transport: TransportConfig;
  readonly appName: string;
  readonly version?: string;
  readonly environment?: string;
  readonly labels?: Record<string, string>;
  readonly dynamicLabels?: Record<string, () => string | number>;
  readonly buffer?: BufferConfig;
  readonly filter?: FilterConfig;
  readonly circuitBreaker?: CircuitBreakerConfig;
  readonly integrations?: IntegrationsConfig;
  readonly performance?: PerformanceConfig;
  readonly deadLetterQueue?: DeadLetterQueueConfig;
  readonly enableMetrics?: boolean;
  readonly enableHealthCheck?: boolean;
  readonly interceptConsole?: boolean;
  readonly preserveOriginalConsole?: boolean;
  readonly debug?: boolean;
  readonly silentErrors?: boolean;
}

export interface ResolvedLogsInterceptorConfig {
  readonly transport: Required<Omit<TransportConfig, 'compression' | 'maxWorkers'>> & {
    compression: 'none' | 'gzip' | 'brotli' | 'snappy';
    maxWorkers?: number;
  };
  readonly appName: string;
  readonly version: string;
  readonly environment: string;
  readonly labels: Record<string, string>;
  readonly dynamicLabels: Record<string, () => string | number>;
  readonly buffer: Required<BufferConfig>;
  readonly filter: Required<FilterConfig>;
  readonly circuitBreaker: Required<CircuitBreakerConfig>;
  readonly integrations: IntegrationsConfig;
  readonly performance: Required<Omit<PerformanceConfig, 'maxWorkers'>> & { maxWorkers?: number };
  readonly deadLetterQueue?: DeadLetterQueueConfig;
  readonly enableMetrics: boolean;
  readonly enableHealthCheck: boolean;
  readonly interceptConsole: boolean;
  readonly preserveOriginalConsole: boolean;
  readonly debug: boolean;
  readonly silentErrors: boolean;
}



