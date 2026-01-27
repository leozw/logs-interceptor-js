import { init } from '../src';

/**
 * FULL CONFIGURATION REFERENCE
 * 
 * This example shows EVERY possible configuration option available in the library.
 * Use this as a reference when you need fine-grained control.
 */

init({
  // --- CORE IDENTITY ---
  appName: 'my-service-name', // Required: Service identifier in Loki
  version: '1.2.0',           // Optional: App version (added to every log)
  environment: 'production',  // Optional: Env (dev, staging, prod)

  // --- LOGGING BEHAVIOR ---
  interceptConsole: true,        // Highly Recommended: Captures console.log/error/warn
  preserveOriginalConsole: true, // If true, logs still show up in stdout (useful for local dev)
  silentErrors: false,           // If true, internal library errors are squelched
  debug: false,                  // If true, prints internal library debug info to stdout

  // --- METADATA & LABELS ---
  // Static labels added to every log stream
  labels: {
    region: 'us-east-1',
    tier: 'gold'
  },
  // Dynamic labels evaluated at runtime (use carefully!)
  dynamicLabels: {
    pod_id: () => process.env.POD_ID || 'unknown'
  },

  // --- TRANSPORT (LOKI CONNECTION) ---
  transport: {
    // Connection Details
    url: process.env.LOKI_URL || 'http://localhost:3100/loki/api/v1/push',
    tenantId: 'my-tenant-id', // X-Scope-OrgID header
    authToken: 'my-bearer-token', // Authorization: Bearer <token>

    // Resilience
    timeout: 5000,      // Connection timeout in ms
    maxRetries: 3,      // Number of retries on failure
    retryDelay: 1000,   // Base delay for exponential backoff

    // Performance / Networking
    enableConnectionPooling: true, // Use persistent HTTP connections (Undici)
    maxSockets: 50,                // Max concurrent socket connections

    // Compression
    // 'snappy' (Best Speed/Size), 'gzip' (Universal), 'brotli' (Best Size), 'none'
    compression: 'snappy',
    compressionLevel: 6,           // 1-9 (higher = CPU intensive)
    compressionThreshold: 1024,    // Only compress logs larger than 1KB

    // Workers
    useWorkers: true, // Offload compression to worker threads
    maxWorkers: 2,    // Max worker threads to spawn
  },

  // --- BUFFERING (BATCHING) ---
  buffer: {
    maxSize: 1000,       // Max log entries per batch
    flushInterval: 5000, // Max wait time (ms) before sending
    maxMemoryMB: 50,     // Safety limit: if buffer exceeds this, force flush
    maxAge: 30000,       // Max age of any single log in buffer
    autoFlush: true,     // Automatically flush based on interval/size
  },

  // --- FILTERING & SANITIZATION ---
  filter: {
    // Only capture these levels
    levels: ['info', 'warn', 'error', 'fatal'],

    // Drop logs matching regex
    patterns: [
      /health\/check/, // Ignore health check logs
    ],

    // Sampling (0.0 - 1.0) - 1.0 = 100% of logs
    samplingRate: 1.0,

    // Redact sensitive data (Credit Cards, Secrets)
    sanitize: true,
    sensitivePatterns: [
      /password/i,
      /token/i,
      /secret/i,
      /credit[-_]?card/i
    ],

    // Truncate huge messages
    maxMessageLength: 8192,
  },

  // --- RESILIENCE (CIRCUIT BREAKER) ---
  circuitBreaker: {
    enabled: true,
    failureThreshold: 20, // Open circuit after 20 consecutive failures
    resetTimeout: 30000,  // Wait 30s before trying again
    halfOpenRequests: 3,  // Number of trial requests in Half-Open state
  },

  // --- DATA LOSS PREVENTION (DLQ) ---
  deadLetterQueue: {
    enabled: true,
    type: 'file',       // 'file' (save to disk) or 'memory' (unreliable)
    basePath: './.logs-dlq', // Directory for failed logs
    maxSize: 50,        // Max MB size of DLQ folder
    maxRetries: 10,     // Max retries for re-ingesting DLQ files
  },

  // --- PERFORMANCE TUNING ---
  performance: {
    useWorkers: true,
    maxConcurrentFlushes: 5, // How many HTTP requests can be in-flight
    workerTimeout: 30000,    // Kill worker if task takes > 30s
  },

  // --- INTEGRATIONS ---
  integrations: {
    // Winston Adapter Config
    winston: {
      enabled: true,
      levels: {
        // Map Winston levels to Loki levels
        verbose: 'debug',
        silly: 'debug'
      }
    },
    // Morgan (HTTP) Adapter Config
    morgan: {
      enabled: true,
      format: 'combined'
    }
  },

  // --- SYSTEM MONITORING ---
  enableMetrics: true,    // Track internal metrics (buffer size, drop rate)
  enableHealthCheck: true // Expose .getHealth() checks
});
