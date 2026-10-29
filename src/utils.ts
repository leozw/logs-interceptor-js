import { boundedSnapshot } from "./infrastructure/memory/BoundedSnapshot";
const originalWarning = console.warn.bind(console);
export function internalWarn(message: string, _context?: unknown): void {
  if (process.env.LOGS_INTERCEPTOR_SILENT_ERRORS !== 'true') originalWarning(`[logs-interceptor] ${message}`);
}
import * as crypto from 'crypto';
import { LogsInterceptorConfig } from './application/config/LogsInterceptorConfig';

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

export interface TransportOptions {
  url: string;
  tenantId: string;
  authToken?: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  compression?: boolean;
}

/**
 * Safely stringify any value, handling circular references and non-serializable objects
 */
export function safeStringify(
  value: unknown,
  maxDepth: number = 10,
  maxBytes = 16_384,
): string {
  return JSON.stringify(boundedSnapshot(value, maxDepth, maxBytes));
}

/**
 * Detect sensitive data in a string
 */
export function detectSensitiveData(text: string, patterns: RegExp[]): boolean {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return true;
    }
  }

  const commonPatterns = [
    /\b[A-Za-z0-9._%+-]{1,256}@[A-Za-z0-9.-]{1,256}\.[A-Za-z]{2,63}\b/, // Bounded email scan
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
  sensitivePatterns: RegExp[],
): Record<string, unknown> {
  data = boundedSnapshot(data) as Record<string, unknown>;
  if (!data || typeof data !== 'object') return { _value: data };
  const seen = new WeakSet<object>();
  const state = { entries: 0 };

  const visit = (
    value: Record<string, unknown>,
    depth: number,
  ): Record<string, unknown> => {
    if (seen.has(value)) {
      return { _circular: '[REDACTED]' };
    }
    if (depth >= 8 || state.entries >= 500) {
      return { _truncated: '[LIMIT_REACHED]' };
    }

    seen.add(value);
    const sanitized: Record<string, unknown> = Object.create(null);

    for (const [key, nestedValue] of Object.entries(value)) {
      state.entries++;
      if (state.entries > 500) {
        sanitized._truncated = '[ENTRY_LIMIT_REACHED]';
        break;
      }
      const isKeySensitive = sensitivePatterns.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(key);
      });

      if (isKeySensitive) {
        sanitized[key] = '[REDACTED]';
        continue;
      }

      if (typeof nestedValue === 'string') {
        const limitedValue =
          nestedValue.length > 4096
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
            const limitedItem =
              item.length > 4096
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
        sanitized[key] = visit(
          nestedValue as Record<string, unknown>,
          depth + 1,
        );
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
  return crypto
    .createHash('sha256')
    .update(data)
    .digest('hex')
    .substring(0, 16);
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
    // Support JSON format
    if (labelsString.startsWith('{')) {
      return JSON.parse(labelsString);
    }
    
    // Support key=value format
    const pairs = labelsString.split(',');
    for (const pair of pairs) {
      const [key, ...valueParts] = pair.split('=');
      if (key && valueParts.length > 0) {
        labels[key.trim()] = valueParts.join('=').trim();
      }
    }
  } catch (error) {
    console.warn('Failed to parse labels from environment:', error);
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
      
    case 'deterministic':
      // Use a hash of the key to determine sampling
      if (!key) return Math.random() < rate;
      const hash = crypto.createHash('md5').update(key).digest();
      const hashValue = hash.readUInt32BE(0) / 0xFFFFFFFF;
      return hashValue < rate;
      
    case 'adaptive':
      // Implement adaptive sampling based on load
      // This is a simplified version - in production, you'd track actual load
      const cpuUsage = process.cpuUsage();
      const loadFactor = Math.min(1, cpuUsage.user / 1000000000); // Normalize to 0-1
      const adjustedRate = rate * (1 - loadFactor * 0.5); // Reduce sampling under load
      return Math.random() < adjustedRate;
      
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
  return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
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
  
  const config: any = {};
  
  // Transport configuration
  if (env.LOGS_INTERCEPTOR_URL || env.LOGS_INTERCEPTOR_TENANT_ID || env.LOGS_INTERCEPTOR_AUTH_TOKEN) {
    const transport: any = {};
    if (env.LOGS_INTERCEPTOR_URL) {
      transport.url = env.LOGS_INTERCEPTOR_URL;
    }
    if (env.LOGS_INTERCEPTOR_TENANT_ID) {
      transport.tenantId = env.LOGS_INTERCEPTOR_TENANT_ID;
    }
    if (env.LOGS_INTERCEPTOR_AUTH_TOKEN) {
      transport.authToken = env.LOGS_INTERCEPTOR_AUTH_TOKEN;
    }
    config.transport = transport;
  }
  
  // Application metadata
  if (env.LOGS_INTERCEPTOR_APP_NAME) {
    config.appName = env.LOGS_INTERCEPTOR_APP_NAME;
  }
  
  if (env.LOGS_INTERCEPTOR_ENVIRONMENT) {
    config.environment = env.LOGS_INTERCEPTOR_ENVIRONMENT;
  }
  
  if (env.LOGS_INTERCEPTOR_VERSION) {
    config.version = env.LOGS_INTERCEPTOR_VERSION;
  }
  
  // Labels
  if (env.LOGS_INTERCEPTOR_LABELS) {
    config.labels = parseLabels(env.LOGS_INTERCEPTOR_LABELS);
  }
  
  // Buffer configuration
  const buffer: any = {};
  if (env.LOGS_INTERCEPTOR_BUFFER_SIZE) {
    const bufferSize = parseInt(env.LOGS_INTERCEPTOR_BUFFER_SIZE, 10);
    if (!isNaN(bufferSize) && bufferSize > 0) {
      buffer.maxSize = bufferSize;
    }
  }
  
  if (env.LOGS_INTERCEPTOR_MAX_MEMORY_MB) {
    const maxMemory = parseInt(env.LOGS_INTERCEPTOR_MAX_MEMORY_MB, 10);
    if (!isNaN(maxMemory) && maxMemory > 0) {
      buffer.maxMemoryMB = maxMemory;
    }
  }
  
  if (env.LOGS_INTERCEPTOR_FLUSH_INTERVAL) {
    const flushInterval = parseInt(env.LOGS_INTERCEPTOR_FLUSH_INTERVAL, 10);
    if (!isNaN(flushInterval) && flushInterval > 0) {
      buffer.flushInterval = flushInterval;
    }
  }
  
  if (Object.keys(buffer).length > 0) {
    config.buffer = buffer;
  }
  
  // Filtering
  const filter: any = {};
  if (env.LOGS_INTERCEPTOR_LOG_LEVEL) {
    const levels = env.LOGS_INTERCEPTOR_LOG_LEVEL.split(',')
      .map(level => level.trim().toLowerCase())
      .filter(level => ['debug', 'info', 'warn', 'error', 'fatal'].includes(level));
    
    if (levels.length > 0) {
      filter.levels = levels as any[];
    }
  }
  
  if (env.LOGS_INTERCEPTOR_SAMPLING_RATE) {
    const samplingRate = parseFloat(env.LOGS_INTERCEPTOR_SAMPLING_RATE);
    if (!isNaN(samplingRate) && samplingRate >= 0 && samplingRate <= 1) {
      filter.samplingRate = samplingRate;
    }
  }
  
  if (env.LOGS_INTERCEPTOR_SANITIZE) {
    filter.sanitize = env.LOGS_INTERCEPTOR_SANITIZE.toLowerCase() === 'true';
  }
  
  if (Object.keys(filter).length > 0) {
    config.filter = filter;
  }
  
  // Circuit breaker
  if (env.LOGS_INTERCEPTOR_CIRCUIT_BREAKER) {
    config.circuitBreaker = {
      enabled: env.LOGS_INTERCEPTOR_CIRCUIT_BREAKER.toLowerCase() === 'true',
    };
  }
  
  // Feature flags
  if (env.LOGS_INTERCEPTOR_DEBUG) {
    config.debug = env.LOGS_INTERCEPTOR_DEBUG.toLowerCase() === 'true';
  }
  
  if (env.LOGS_INTERCEPTOR_ENABLED) {
    const enabled = env.LOGS_INTERCEPTOR_ENABLED.toLowerCase() === 'true';
    if (!enabled) {
      // Return a minimal config that effectively disables logging
      return {
        filter: {
          levels: [],
        },
      };
    }
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
  // Handle transport merge carefully
  const transport = envConfig.transport || userConfig.transport
    ? { ...envConfig.transport, ...userConfig.transport } as TransportOptions
    : undefined;

  // Handle other nested objects
  const buffer = envConfig.buffer || userConfig.buffer
    ? { ...envConfig.buffer, ...userConfig.buffer }
    : undefined;
  
  const filter = envConfig.filter || userConfig.filter
    ? { ...envConfig.filter, ...userConfig.filter }
    : undefined;
  
  const labels = envConfig.labels || userConfig.labels
    ? { ...envConfig.labels, ...userConfig.labels }
    : undefined;
  
  const dynamicLabels = envConfig.dynamicLabels || userConfig.dynamicLabels
    ? { ...envConfig.dynamicLabels, ...userConfig.dynamicLabels }
    : undefined;
  
  const circuitBreaker = envConfig.circuitBreaker || userConfig.circuitBreaker
    ? { ...envConfig.circuitBreaker, ...userConfig.circuitBreaker }
    : undefined;
  
  const integrations = envConfig.integrations || userConfig.integrations
    ? { ...envConfig.integrations, ...userConfig.integrations }
    : undefined;
  
  const performance = envConfig.performance || userConfig.performance
    ? { ...envConfig.performance, ...userConfig.performance }
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
  };
}

// validateConfig moved to ConfigService

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
  
  // Extract additional properties
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
export function parseStackTrace(stack: string): Array<{
  function: string;
  file: string;
  line: number;
  column: number;
}> {
  const lines = stack.split('\n');
  const frames: Array<any> = [];
  
  for (const line of lines) {
    const match = line.match(/at\s+(.*?)\s+\((.*?):(\d+):(\d+)\)/);
    if (match) {
      frames.push({
        function: match[1],
        file: match[2],
        line: parseInt(match[3], 10),
        column: parseInt(match[4], 10),
      });
    }
  }
  
  return frames.slice(0, 10); // Limit to 10 frames
}
