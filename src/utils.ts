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
export function safeStringify(value: unknown, maxDepth: number = 10): string {
  const seen = new WeakSet();
  let depth = 0;
  
  try {
    return JSON.stringify(value, function(key, val) {
      // Check depth
      if (depth > maxDepth) {
        return '[Max Depth Reached]';
      }
      
      if (val === null || val === undefined) {
        return val;
      }
      
      if (typeof val === 'object') {
        depth++;
        if (seen.has(val)) {
          return '[Circular Reference]';
        }
        seen.add(val);
        
        // Handle special objects
        if (val instanceof Buffer) {
          return `[Buffer: ${val.length} bytes]`;
        }
        
        if (val instanceof Promise) {
          return '[Promise]';
        }
        
        if (val instanceof WeakMap || val instanceof WeakSet) {
          return `[${val.constructor.name}]`;
        }
      }
      
      if (typeof val === 'function') {
        return `[Function: ${val.name || 'anonymous'}]`;
      }
      
      if (typeof val === 'symbol') {
        return `[Symbol: ${val.toString()}]`;
      }
      
      if (typeof val === 'bigint') {
        return val.toString() + 'n';
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
      
      return val;
    }, 2);
  } catch (error) {
    return `[Unserializable: ${error instanceof Error ? error.message : 'Unknown error'}]`;
  }
}

/**
 * Detect sensitive data in a string
 */
export function detectSensitiveData(text: string, patterns: RegExp[]): boolean {
  // Check against patterns
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return true;
    }
  }
  
  // Check for common sensitive patterns
  const commonPatterns = [
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
    /\b(?:\d{4}[-\s]?){3}\d{4}\b/, // Credit card
    /\b\d{3}-\d{2}-\d{4}\b/, // SSN
    /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/, // CPF (Brazilian)
    /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/i, // Bearer tokens
    /Basic\s+[A-Za-z0-9+\/]+=*/i, // Basic auth
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
  const sanitized: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(data)) {
    // Check if key matches sensitive patterns
    const isKeySensitive = sensitivePatterns.some(pattern => pattern.test(key));
    
    if (isKeySensitive) {
      sanitized[key] = '[REDACTED]';
      continue;
    }
    
    // Handle different value types
    if (typeof value === 'string') {
      if (detectSensitiveData(value, sensitivePatterns)) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    } else if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value)) {
        sanitized[key] = value.map(item => {
          if (typeof item === 'string' && detectSensitiveData(item, sensitivePatterns)) {
            return '[REDACTED]';
          }
          if (typeof item === 'object' && item !== null) {
            return sanitizeData(item as Record<string, unknown>, sensitivePatterns);
          }
          return item;
        });
      } else {
        sanitized[key] = sanitizeData(value as Record<string, unknown>, sensitivePatterns);
      }
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
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