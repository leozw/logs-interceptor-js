import { init } from '../src';

/**
 * Full configuration reference (V3)
 */

init({
  appName: process.env.LOGS_APP_NAME || 'my-service-name',
  version: process.env.LOGS_APP_VERSION || '1.2.0',
  environment: process.env.LOGS_ENVIRONMENT || 'production',

  interceptConsole: true,
  preserveOriginalConsole: true,
  silentErrors: false,
  debug: false,

  labels: {
    region: 'us-east-1',
    tier: 'gold',
  },

  dynamicLabels: {
    pod_id: () => process.env.POD_ID || 'unknown',
  },

  transport: {
    url: process.env.LOGS_URL || 'http://localhost:3100/loki/api/v1/push',
    tenantId: process.env.LOGS_TENANT || 'my-tenant-id',
    authToken: process.env.LOGS_TOKEN,
    timeout: 10_000,
    maxRetries: 3,
    retryDelay: 1000,
    enableConnectionPooling: true,
    maxSockets: 50,
    compression: 'snappy',
    compressionLevel: 6,
    compressionThreshold: 1024,
    useWorkers: true,
    maxWorkers: 2,
    workerTimeout: 30_000,
  },

  buffer: {
    maxSize: 1000,
    flushInterval: 5000,
    maxMemoryMB: 50,
    maxAge: 30_000,
    autoFlush: true,
  },

  filter: {
    levels: ['info', 'warn', 'error', 'fatal'],
    patterns: [/health\/check/],
    samplingRate: 1.0,
    sanitize: true,
    sensitivePatterns: [/password/i, /token/i, /secret/i, /credit[-_]?card/i],
    maxMessageLength: 8192,
  },

  circuitBreaker: {
    enabled: true,
    failureThreshold: 20,
    resetTimeout: 30_000,
    halfOpenRequests: 3,
  },

  deadLetterQueue: {
    enabled: true,
    type: 'file',
    basePath: './.logs-dlq',
    maxSize: 1000,
    maxRetries: 10,
  },

  performance: {
    useWorkers: true,
    maxConcurrentFlushes: 5,
    workerTimeout: 30_000,
  },

  integrations: {
    winston: {
      enabled: true,
      levels: {
        verbose: 'debug',
        silly: 'debug',
      },
    },
    morgan: {
      enabled: true,
      format: 'combined',
    },
  },

  enableMetrics: true,
  enableHealthCheck: true,
});
