import * as crypto from 'crypto';
import { LogsInterceptorConfig } from './application/config/LogsInterceptorConfig';
import { LogLevel, LogLevelVO } from './domain/value-objects/LogLevel';

const internalConsole = {
  debug: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

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
  LOGS_FILTER_MAX_CONTEXT_BYTES?: string;

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
  LOGS_MAX_PENDING_BATCHES?: string;
  LOGS_WORKER_TIMEOUT?: string;

  LOGS_INTERCEPT_CONSOLE?: string;
  LOGS_PRESERVE_ORIGINAL_CONSOLE?: string;
  LOGS_ENABLE_METRICS?: string;
  LOGS_ENABLE_HEALTH_CHECK?: string;
  LOGS_DEBUG?: string;
  LOGS_SILENT_ERRORS?: string;

  LOGS_AUTO_INIT?: string;
  LOGS_ENABLED?: string;

  [key: string]: string | undefined;
}

export interface TransportOptions {
  url: string;
  tenantId: string;
  authToken?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  compression?: 'none' | 'gzip' | 'brotli' | 'snappy' | boolean;
}

export function parseBool(
  value: string | undefined,
  defaultValue: boolean
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

export function parseIntRange(
  value: string | undefined,
  defaultValue: number,
  min: number,
  max: number
): number {
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return defaultValue;
  }

  if (parsed < min || parsed > max) {
    return defaultValue;
  }

  return parsed;
}

export function parseFloatRange(
  value: string | undefined,
  defaultValue: number,
  min: number,
  max: number
): number {
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed)) {
    return defaultValue;
  }

  if (parsed < min || parsed > max) {
    return defaultValue;
  }

  return parsed;
}

export function isDebugEnabled(): boolean {
  return parseBool(process.env.LOGS_DEBUG, false);
}

export function isSilentErrorsEnabled(): boolean {
  return parseBool(process.env.LOGS_SILENT_ERRORS, false);
}

export function internalDebug(message: string, context?: unknown): void {
  if (!isDebugEnabled() || isSilentErrorsEnabled()) {
    return;
  }

  if (context !== undefined) {
    internalConsole.debug(`[logs-interceptor] ${message}`, context);
    return;
  }

  internalConsole.debug(`[logs-interceptor] ${message}`);
}

export function internalWarn(message: string, context?: unknown): void {
  if (isSilentErrorsEnabled()) {
    return;
  }

  if (context !== undefined) {
    internalConsole.warn(`[logs-interceptor] ${message}`, context);
    return;
  }

  internalConsole.warn(`[logs-interceptor] ${message}`);
}

export function internalError(message: string, context?: unknown): void {
  if (isSilentErrorsEnabled()) {
    return;
  }

  if (context !== undefined) {
    internalConsole.error(`[logs-interceptor] ${message}`, context);
    return;
  }

  internalConsole.error(`[logs-interceptor] ${message}`);
}

/**
 * Safely stringify any value, handling circular references and non-serializable objects
 */
export function safeStringify(value: unknown, maxDepth: number = 10): string {
  const seen = new WeakSet();

  try {
    return JSON.stringify(
      value,
      function replacer(_key, val) {
        if (val === null || val === undefined) {
          return val;
        }

        if (typeof val === 'function') {
          return `[Function: ${val.name || 'anonymous'}]`;
        }

        if (typeof val === 'symbol') {
          return `[Symbol: ${val.toString()}]`;
        }

        if (typeof val === 'bigint') {
          return `${val.toString()}n`;
        }

        if (val instanceof Error) {
          return {
            name: val.name,
            message: val.message,
            stack: val.stack,
            code: (val as any).code,
          };
        }

        if (val instanceof Date) {
          return val.toISOString();
        }

        if (val instanceof RegExp) {
          return val.toString();
        }

        if (typeof val === 'object') {
          if (seen.has(val)) {
            return '[Circular Reference]';
          }
          seen.add(val);

          const depth = getObjectDepth(val, maxDepth);
          if (depth > maxDepth) {
            return '[Max Depth Reached]';
          }

          if (val instanceof Buffer) {
            return `[Buffer: ${val.length} bytes]`;
          }

          if (val instanceof Promise) {
            return '[Promise]';
          }

          if (val instanceof WeakMap || val instanceof WeakSet) {
            return `[${val.constructor.name}]`;
          }

          if (val instanceof Map) {
            return {
              type: 'Map',
              entries: Array.from(val.entries()),
            };
          }

          if (val instanceof Set) {
            return {
              type: 'Set',
              values: Array.from(val.values()),
            };
          }
        }

        return val;
      },
      0
    );
  } catch (error) {
    return `[Unserializable: ${error instanceof Error ? error.message : 'Unknown error'}]`;
  }
}

function getObjectDepth(value: unknown, maxDepth: number): number {
  if (value === null || typeof value !== 'object') {
    return 0;
  }

  let currentDepth = 0;
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }];
  const visited = new WeakSet<object>();

  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) {
      continue;
    }

    const { value: current, depth } = item;
    if (depth > currentDepth) {
      currentDepth = depth;
    }

    if (currentDepth > maxDepth) {
      return currentDepth;
    }

    if (current === null || typeof current !== 'object') {
      continue;
    }

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    for (const nested of Object.values(current as Record<string, unknown>)) {
      if (nested && typeof nested === 'object') {
        stack.push({ value: nested, depth: depth + 1 });
      }
    }
  }

  return currentDepth;
}

/**
 * Detect sensitive data in a string
 */
export function detectSensitiveData(text: string, patterns: RegExp[]): boolean {
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return true;
    }
  }

  const commonPatterns = [
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
    /\b(?:\d{4}[-\s]?){3}\d{4}\b/, // Credit card
    /\b\d{3}-\d{2}-\d{4}\b/, // SSN
    /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/, // CPF (Brazilian)
    /Bearer\s+[A-Za-z0-9\-._~+\/=]*/i, // Bearer tokens
    /Basic\s+[A-Za-z0-9+\/=]*/i, // Basic auth
  ];

  for (const pattern of commonPatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }

  return false;
}

/**
 * Sanitize sensitive data from an object
 */
export function sanitizeData(
  data: Record<string, unknown>,
  sensitivePatterns: RegExp[]
): Record<string, unknown> {
  const seen = new WeakSet<object>();
  const state = { entries: 0 };

  const visit = (value: Record<string, unknown>, depth: number): Record<string, unknown> => {
    if (seen.has(value)) {
      return { _circular: '[REDACTED]' };
    }
    if (depth >= 8 || state.entries >= 500) {
      return { _truncated: '[LIMIT_REACHED]' };
    }

    seen.add(value);
    const sanitized: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      state.entries++;
      if (state.entries > 500) {
        sanitized._truncated = '[ENTRY_LIMIT_REACHED]';
        break;
      }
    const isKeySensitive = sensitivePatterns.some((pattern) => pattern.test(key));

    if (isKeySensitive) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

      if (typeof nestedValue === 'string') {
        const limitedValue = nestedValue.length > 4096
          ? `${nestedValue.slice(0, 4096)}...[truncated]`
          : nestedValue;
        sanitized[key] = detectSensitiveData(limitedValue, sensitivePatterns)
        ? '[REDACTED]'
          : limitedValue;
      continue;
    }

      if (Array.isArray(nestedValue)) {
        sanitized[key] = nestedValue.slice(0, 100).map((item) => {
        if (typeof item === 'string') {
            const limitedItem = item.length > 4096
              ? `${item.slice(0, 4096)}...[truncated]`
              : item;
            return detectSensitiveData(limitedItem, sensitivePatterns)
              ? '[REDACTED]'
              : limitedItem;
        }

        if (item && typeof item === 'object') {
            return visit(item as Record<string, unknown>, depth + 1);
        }

        return item;
      });
      continue;
    }

      if (nestedValue && typeof nestedValue === 'object') {
        sanitized[key] = visit(nestedValue as Record<string, unknown>, depth + 1);
      continue;
    }

      sanitized[key] = nestedValue;
    }

    return sanitized;
  };

  return visit(data, 0);
}

/**
 * Hash sensitive data for tracking without exposing it
 */
export function hashSensitiveData(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
}

/**
 * Parse labels from environment variable string format
 * Format: "key1=value1,key2=value2"
 */
export function parseLabels(labelsString: string): Record<string, string> {
  const labels: Record<string, string> = {};

  if (!labelsString) {
    return labels;
  }

  try {
    if (labelsString.startsWith('{')) {
      return JSON.parse(labelsString);
    }

    const pairs = labelsString.split(',');
    for (const pair of pairs) {
      const [key, ...valueParts] = pair.split('=');
      if (key && valueParts.length > 0) {
        labels[key.trim()] = valueParts.join('=').trim();
      }
    }
  } catch (error) {
    internalWarn('Failed to parse labels from environment', error);
  }

  return labels;
}

/**
 * Determine if a log should be sampled based on sampling rate
 */
export function shouldSample(rate: number): boolean {
  if (rate >= 1.0) return true;
  if (rate <= 0.0) return false;
  return Math.random() < rate;
}

/**
 * Enhanced sampling with support for different strategies
 */
export function shouldSampleAdvanced(
  rate: number,
  strategy: 'random' | 'deterministic' | 'adaptive' = 'random',
  key?: string
): boolean {
  if (rate >= 1.0) return true;
  if (rate <= 0.0) return false;

  switch (strategy) {
    case 'random':
      return Math.random() < rate;

    case 'deterministic': {
      if (!key) return Math.random() < rate;
      const hash = crypto.createHash('md5').update(key).digest();
      const hashValue = hash.readUInt32BE(0) / 0xffffffff;
      return hashValue < rate;
    }

    case 'adaptive': {
      const cpuUsage = process.cpuUsage();
      const loadFactor = Math.min(1, cpuUsage.user / 1_000_000_000);
      const adjustedRate = rate * (1 - loadFactor * 0.5);
      return Math.random() < adjustedRate;
    }

    default:
      return Math.random() < rate;
  }
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Math.round((bytes / Math.pow(1024, i)) * 100) / 100} ${sizes[i]}`;
}

/**
 * Calculate compression ratio
 */
export function calculateCompressionRatio(original: number, compressed: number): number {
  if (original === 0) return 0;
  return Math.round((1 - compressed / original) * 100);
}

/**
 * Load configuration from environment variables
 */
export function loadConfigFromEnv(): Partial<LogsInterceptorConfig> {
  const env = process.env as EnvironmentConfig;

  if (!parseBool(env.LOGS_ENABLED, true)) {
    return {
      filter: {
        levels: [],
      },
    };
  }

  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('LOGS_LABEL_') || value === undefined) {
      continue;
    }

    const labelKey = key.slice('LOGS_LABEL_'.length).toLowerCase();
    if (labelKey.length > 0) {
      labels[labelKey] = value;
    }
  }

  const levels = (env.LOGS_FILTER_LEVELS || 'debug,info,warn,error,fatal')
    .split(',')
    .map((level) => level.trim().toLowerCase())
    .filter((level): level is LogLevel => LogLevelVO.isValid(level));

  const compression =
    env.LOGS_COMPRESSION === 'none' ||
    env.LOGS_COMPRESSION === 'gzip' ||
    env.LOGS_COMPRESSION === 'brotli' ||
    env.LOGS_COMPRESSION === 'snappy'
      ? env.LOGS_COMPRESSION
      : 'gzip';

  const dlqType = env.LOGS_DLQ_TYPE === 'file' ? 'file' : 'memory';

  const config: Partial<LogsInterceptorConfig> = {
    transport: {
      url: env.LOGS_URL ?? '',
      tenantId: env.LOGS_TENANT ?? '',
      authToken: env.LOGS_TOKEN,
      timeout: parseIntRange(env.LOGS_TIMEOUT, 5_000, 0, 600_000),
      maxRetries: parseIntRange(env.LOGS_MAX_RETRIES, 1, 0, 20),
      retryDelay: parseIntRange(env.LOGS_RETRY_DELAY, 1_000, 0, 120_000),
      compression,
      compressionLevel: parseIntRange(env.LOGS_COMPRESSION_LEVEL, 6, 0, 11),
      compressionThreshold: parseIntRange(env.LOGS_COMPRESSION_THRESHOLD, 1024, 0, Number.MAX_SAFE_INTEGER),
      useWorkers: parseBool(env.LOGS_USE_WORKERS, false),
      maxWorkers: parseIntRange(env.LOGS_MAX_WORKERS, 2, 1, 64),
      enableConnectionPooling: parseBool(env.LOGS_CONNECTION_POOLING, true),
      maxSockets: parseIntRange(env.LOGS_MAX_SOCKETS, 10, 1, 1024),
      workerTimeout: parseIntRange(env.LOGS_WORKER_TIMEOUT, 30_000, 1_000, 300_000),
    },
    appName: env.LOGS_APP_NAME ?? '',
    environment: env.LOGS_ENVIRONMENT ?? process.env.NODE_ENV ?? 'production',
    version: env.LOGS_APP_VERSION ?? '1.0.0',
    labels,
    buffer: {
      maxSize: parseIntRange(env.LOGS_BUFFER_MAX_SIZE, 100, 1, 1_000_000),
      flushInterval: parseIntRange(env.LOGS_BUFFER_FLUSH_INTERVAL, 5_000, 1, 300_000),
      maxMemoryMB: parseIntRange(env.LOGS_BUFFER_MAX_MEMORY_MB, 32, 1, 32_768),
      maxAge: parseIntRange(env.LOGS_BUFFER_MAX_AGE, 30_000, 100, 86_400_000),
      autoFlush: parseBool(env.LOGS_BUFFER_AUTO_FLUSH, true),
    },
    filter: {
      levels,
      samplingRate: parseFloatRange(env.LOGS_FILTER_SAMPLING_RATE, 1.0, 0, 1),
      sanitize: parseBool(env.LOGS_FILTER_SANITIZE, true),
      maxMessageLength: parseIntRange(env.LOGS_FILTER_MAX_MESSAGE_LENGTH, 8192, 64, 1_000_000),
      maxContextBytes: parseIntRange(env.LOGS_FILTER_MAX_CONTEXT_BYTES, 16_384, 256, 1_048_576),
    },
    circuitBreaker: {
      enabled: parseBool(env.LOGS_CIRCUIT_BREAKER_ENABLED, true),
      failureThreshold: parseIntRange(env.LOGS_CIRCUIT_BREAKER_FAILURE_THRESHOLD, 50, 1, 100_000),
      resetTimeout: parseIntRange(env.LOGS_CIRCUIT_BREAKER_RESET_TIMEOUT, 30_000, 1_000, 3_600_000),
      halfOpenRequests: parseIntRange(env.LOGS_CIRCUIT_BREAKER_HALF_OPEN_REQUESTS, 3, 1, 100),
    },
    deadLetterQueue: {
      enabled: parseBool(env.LOGS_DLQ_ENABLED, true),
      type: dlqType,
      maxSize: parseIntRange(env.LOGS_DLQ_MAX_SIZE, 1000, 1, 1_000_000),
      maxRetries: parseIntRange(env.LOGS_DLQ_MAX_RETRIES, 3, 0, 100),
      basePath: env.LOGS_DLQ_BASE_PATH ?? './.logs-dlq',
    },
    performance: {
      useWorkers: parseBool(env.LOGS_USE_WORKERS, false),
      maxConcurrentFlushes: parseIntRange(env.LOGS_MAX_CONCURRENT_FLUSHES, 2, 1, 256),
      maxPendingBatches: parseIntRange(env.LOGS_MAX_PENDING_BATCHES, 2, 1, 1024),
      maxWorkers: parseIntRange(env.LOGS_MAX_WORKERS, 2, 1, 64),
      compressionLevel: parseIntRange(env.LOGS_COMPRESSION_LEVEL, 6, 0, 11),
      workerTimeout: parseIntRange(env.LOGS_WORKER_TIMEOUT, 30_000, 1_000, 300_000),
    },
    interceptConsole: parseBool(env.LOGS_INTERCEPT_CONSOLE, false),
    preserveOriginalConsole: parseBool(env.LOGS_PRESERVE_ORIGINAL_CONSOLE, true),
    enableMetrics: parseBool(env.LOGS_ENABLE_METRICS, true),
    enableHealthCheck: parseBool(env.LOGS_ENABLE_HEALTH_CHECK, true),
    debug: parseBool(env.LOGS_DEBUG, false),
    silentErrors: parseBool(env.LOGS_SILENT_ERRORS, false),
  };

  if (!config.transport?.url && !config.transport?.tenantId && !config.appName) {
    return {};
  }

  return config;
}

/**
 * Merge configurations with precedence: user config > env config > defaults
 */
export function mergeConfigs(
  userConfig: Partial<LogsInterceptorConfig>,
  envConfig: Partial<LogsInterceptorConfig>
): Partial<LogsInterceptorConfig> {
  const transport =
    envConfig.transport || userConfig.transport
      ? ({ ...envConfig.transport, ...userConfig.transport } as TransportOptions)
      : undefined;

  const buffer =
    envConfig.buffer || userConfig.buffer
      ? { ...envConfig.buffer, ...userConfig.buffer }
      : undefined;

  const filter =
    envConfig.filter || userConfig.filter
      ? { ...envConfig.filter, ...userConfig.filter }
      : undefined;

  const labels =
    envConfig.labels || userConfig.labels
      ? { ...envConfig.labels, ...userConfig.labels }
      : undefined;

  const dynamicLabels =
    envConfig.dynamicLabels || userConfig.dynamicLabels
      ? { ...envConfig.dynamicLabels, ...userConfig.dynamicLabels }
      : undefined;

  const circuitBreaker =
    envConfig.circuitBreaker || userConfig.circuitBreaker
      ? { ...envConfig.circuitBreaker, ...userConfig.circuitBreaker }
      : undefined;

  const integrations =
    envConfig.integrations || userConfig.integrations
      ? { ...envConfig.integrations, ...userConfig.integrations }
      : undefined;

  const performance =
    envConfig.performance || userConfig.performance
      ? { ...envConfig.performance, ...userConfig.performance }
      : undefined;

  const deadLetterQueue =
    envConfig.deadLetterQueue || userConfig.deadLetterQueue
      ? { ...envConfig.deadLetterQueue, ...userConfig.deadLetterQueue }
      : undefined;

  return {
    ...envConfig,
    ...userConfig,
    ...(transport ? { transport } : {}),
    ...(buffer ? { buffer } : {}),
    ...(filter ? { filter } : {}),
    ...(labels ? { labels } : {}),
    ...(dynamicLabels ? { dynamicLabels } : {}),
    ...(circuitBreaker ? { circuitBreaker } : {}),
    ...(integrations ? { integrations } : {}),
    ...(performance ? { performance } : {}),
    ...(deadLetterQueue ? { deadLetterQueue } : {}),
  };
}

/**
 * Create a correlation ID for request tracking
 */
export function createCorrelationId(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Extract metadata from Error objects
 */
export function extractErrorMetadata(error: Error): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };

  const errorObj = error as any;

  if (errorObj.code) metadata.code = errorObj.code;
  if (errorObj.statusCode) metadata.statusCode = errorObj.statusCode;
  if (errorObj.syscall) metadata.syscall = errorObj.syscall;
  if (errorObj.errno) metadata.errno = errorObj.errno;
  if (errorObj.path) metadata.path = errorObj.path;
  if (errorObj.address) metadata.address = errorObj.address;
  if (errorObj.port) metadata.port = errorObj.port;

  return metadata;
}

/**
 * Parse stack trace to extract useful information
 */
export function parseStackTrace(
  stack: string
): Array<{
  function: string;
  file: string;
  line: number;
  column: number;
}> {
  const lines = stack.split('\n');
  const frames: Array<{
    function: string;
    file: string;
    line: number;
    column: number;
  }> = [];

  for (const line of lines) {
    const match = line.match(/at\s+(.*?)\s+\((.*?):(\d+):(\d+)\)/);
    if (match) {
      frames.push({
        function: match[1],
        file: match[2],
        line: Number.parseInt(match[3], 10),
        column: Number.parseInt(match[4], 10),
      });
    }
  }

  return frames.slice(0, 10);
}
