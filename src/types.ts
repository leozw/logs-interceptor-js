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
  droppedByBackpressure: number;
  droppedByDlq: number;
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
  withContext<T>(context: Record<string, unknown>, fn: () => T): T;
  withContextAsync<T>(
    context: Record<string, unknown>,
    fn: () => Promise<T>
  ): Promise<T>;
  getMetrics(): LoggerMetrics;
  getHealth(): HealthStatus;
  destroy(): Promise<void>;
}

export interface EnvironmentConfig {
  LOGS_URL?: string;
  LOGS_TENANT?: string;
  LOGS_TOKEN?: string;
  LOGS_APP_NAME?: string;
  LOGS_APP_VERSION?: string;
  LOGS_ENVIRONMENT?: string;
  LOGS_COMPRESSION?: string;
  LOGS_COMPRESSION_LEVEL?: string;
  LOGS_COMPRESSION_THRESHOLD?: string;
  LOGS_USE_WORKERS?: string;
  LOGS_MAX_WORKERS?: string;
  LOGS_CONNECTION_POOLING?: string;
  LOGS_MAX_SOCKETS?: string;
  LOGS_TIMEOUT?: string;
  LOGS_MAX_RETRIES?: string;
  LOGS_RETRY_DELAY?: string;
  LOGS_BUFFER_MAX_SIZE?: string;
  LOGS_BUFFER_FLUSH_INTERVAL?: string;
  LOGS_BUFFER_MAX_MEMORY_MB?: string;
  LOGS_BUFFER_MAX_AGE?: string;
  LOGS_BUFFER_AUTO_FLUSH?: string;
  LOGS_FILTER_LEVELS?: string;
  LOGS_FILTER_SAMPLING_RATE?: string;
  LOGS_FILTER_SANITIZE?: string;
  LOGS_FILTER_MAX_MESSAGE_LENGTH?: string;
  LOGS_CIRCUIT_BREAKER_ENABLED?: string;
  LOGS_CIRCUIT_BREAKER_FAILURE_THRESHOLD?: string;
  LOGS_CIRCUIT_BREAKER_RESET_TIMEOUT?: string;
  LOGS_CIRCUIT_BREAKER_HALF_OPEN_REQUESTS?: string;
  LOGS_DLQ_ENABLED?: string;
  LOGS_DLQ_TYPE?: string;
  LOGS_DLQ_MAX_SIZE?: string;
  LOGS_DLQ_MAX_RETRIES?: string;
  LOGS_DLQ_BASE_PATH?: string;
  LOGS_MAX_CONCURRENT_FLUSHES?: string;
  LOGS_INTERCEPT_CONSOLE?: string;
  LOGS_PRESERVE_ORIGINAL_CONSOLE?: string;
  LOGS_ENABLE_METRICS?: string;
  LOGS_ENABLE_HEALTH_CHECK?: string;
  LOGS_DEBUG?: string;
  LOGS_SILENT_ERRORS?: string;
}
