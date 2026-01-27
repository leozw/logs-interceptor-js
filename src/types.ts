export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type CircuitBreakerStateType = 'closed' | 'open' | 'half-open';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
  requestId?: string;
  labels?: Record<string, string>;
  metadata?: {
    memoryUsage?: number;
    cpuUsage?: number;
  };
}

export interface LokiStream {
  stream: Record<string, string>;
  values: [string, string][];
}

export interface LokiPayload {
  streams: LokiStream[];
}

export interface TransportOptions {
  url: string;
  tenantId: string;
  authToken?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  compression?: boolean;
}

export interface ResolvedTransportOptions {
  url: string;
  tenantId: string;
  authToken: string;
  timeout: number;
  maxRetries: number;
  retryDelay: number;
  compression: boolean;
}

export interface BufferOptions {
  maxSize?: number;
  flushInterval?: number;
  maxAge?: number;
  autoFlush?: boolean;
  maxMemoryMB?: number;
}

export interface ResolvedBufferOptions {
  maxSize: number;
  flushInterval: number;
  maxAge: number;
  autoFlush: boolean;
  maxMemoryMB: number;
}

export interface FilterOptions {
  levels?: LogLevel[];
  patterns?: RegExp[];
  samplingRate?: number;
  maxMessageLength?: number;
  sanitize?: boolean;
  sensitivePatterns?: RegExp[];
}

export interface ResolvedFilterOptions {
  levels: LogLevel[];
  patterns: RegExp[];
  samplingRate: number;
  maxMessageLength: number;
  sanitize: boolean;
  sensitivePatterns: RegExp[];
}

export interface CircuitBreakerOptions {
  enabled?: boolean;
  failureThreshold?: number;
  resetTimeout?: number;
  halfOpenRequests?: number;
}

export interface ResolvedCircuitBreakerOptions {
  enabled: boolean;
  failureThreshold: number;
  resetTimeout: number;
  halfOpenRequests: number;
}

export interface CircuitBreakerState {
  state: CircuitBreakerStateType;
  failures: number;
  successCount: number;
  lastFailure: number;
  nextAttempt: number;
}

export interface IntegrationsOptions {
  winston?: boolean | WinstonIntegrationConfig;
  pino?: boolean | PinoIntegrationConfig;
  morgan?: boolean | MorganIntegrationConfig;
  bunyan?: boolean | BunyanIntegrationConfig;
}

export interface WinstonIntegrationConfig {
  enabled: boolean;
  levels?: Record<string, LogLevel>;
}

export interface PinoIntegrationConfig {
  enabled: boolean;
  messageKey?: string;
  levelKey?: string;
}

export interface MorganIntegrationConfig {
  enabled: boolean;
  format?: string;
}

export interface BunyanIntegrationConfig {
  enabled: boolean;
  streams?: any[];
}

export interface PerformanceOptions {
  useWorkers?: boolean;
  maxConcurrentFlushes?: number;
  compressionLevel?: number;
}

export interface ResolvedPerformanceOptions {
  useWorkers: boolean;
  maxConcurrentFlushes: number;
  compressionLevel: number;
}

export interface LogsInterceptorConfig {
  // Transport configuration
  transport: TransportOptions;
  
  // Application metadata
  appName: string;
  version?: string;
  environment?: string;
  
  // Static labels
  labels?: Record<string, string>;
  
  // Dynamic labels (computed at runtime)
  dynamicLabels?: Record<string, () => string | number>;
  
  // Buffer configuration
  buffer?: BufferOptions;
  
  // Filtering and sampling
  filter?: FilterOptions;
  
  // Circuit breaker
  circuitBreaker?: CircuitBreakerOptions;
  
  // Integrations with other loggers
  integrations?: IntegrationsOptions;
  
  // Performance tuning
  performance?: PerformanceOptions;
  
  // Performance options
  enableMetrics?: boolean;
  enableHealthCheck?: boolean;
  
  // Console interception
  interceptConsole?: boolean;
  preserveOriginalConsole?: boolean;
  
  // Debug options
  debug?: boolean;
  silentErrors?: boolean;
}

export interface ResolvedLogsInterceptorConfig {
  // Transport configuration
  transport: ResolvedTransportOptions;
  
  // Application metadata
  appName: string;
  version: string;
  environment: string;
  
  // Static labels
  labels: Record<string, string>;
  
  // Dynamic labels (computed at runtime)
  dynamicLabels: Record<string, () => string | number>;
  
  // Buffer configuration
  buffer: ResolvedBufferOptions;
  
  // Filtering and sampling
  filter: ResolvedFilterOptions;
  
  // Circuit breaker
  circuitBreaker: ResolvedCircuitBreakerOptions;
  
  // Integrations
  integrations: IntegrationsOptions;
  
  // Performance
  performance: ResolvedPerformanceOptions;
  
  // Performance options
  enableMetrics: boolean;
  enableHealthCheck: boolean;
  
  // Console interception
  interceptConsole: boolean;
  preserveOriginalConsole: boolean;
  
  // Debug options
  debug: boolean;
  silentErrors: boolean;
}

export interface LoggerMetrics {
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
}

export interface HealthStatus {
  healthy: boolean;
  lastSuccessfulFlush: number;
  consecutiveErrors: number;
  bufferUtilization: number;
  uptime: number;
  memoryUsageMB: number;
  circuitBreakerState: CircuitBreakerStateType;
}

export interface LoggerInstance {
  log(level: LogLevel, message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  fatal(message: string, context?: Record<string, unknown>): void;
  trackEvent(eventName: string, properties?: Record<string, unknown>): void;
  flush(): Promise<void>;
  runWithContext<T>(context: Record<string, any>, fn: () => T): T;
  runWithContextAsync<T>(context: Record<string, any>, fn: () => Promise<T>): Promise<T>;
  getMetrics(): LoggerMetrics;
  getHealth(): HealthStatus;
  getWinstonTransport(): any;
  getPinoStream(): any;
  getMorganStream(): any;
  destroy(): Promise<void>;
}

export interface EnvironmentConfig {
  LOGS_INTERCEPTOR_URL?: string;
  LOGS_INTERCEPTOR_TENANT_ID?: string;
  LOGS_INTERCEPTOR_AUTH_TOKEN?: string;
  LOGS_INTERCEPTOR_APP_NAME?: string;
  LOGS_INTERCEPTOR_ENVIRONMENT?: string;
  LOGS_INTERCEPTOR_VERSION?: string;
  LOGS_INTERCEPTOR_LABELS?: string;
  LOGS_INTERCEPTOR_BUFFER_SIZE?: string;
  LOGS_INTERCEPTOR_FLUSH_INTERVAL?: string;
  LOGS_INTERCEPTOR_LOG_LEVEL?: string;
  LOGS_INTERCEPTOR_ENABLED?: string;
  LOGS_INTERCEPTOR_DEBUG?: string;
  LOGS_INTERCEPTOR_SAMPLING_RATE?: string;
  LOGS_INTERCEPTOR_CIRCUIT_BREAKER?: string;
  LOGS_INTERCEPTOR_SANITIZE?: string;
  LOGS_INTERCEPTOR_MAX_MEMORY_MB?: string;
}