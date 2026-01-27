import { init, logger } from '../src';

/**
 * High-Volume / Extreme Scale Example
 * Configuration tuned for 1000s of logs/sec.
 * Uses Protobuf + Snappy + Worker Threads.
 */

init({
  appName: process.env.LOKI_APP_NAME || 'high-volume-service',

  // Enable console for compatibility, but prefer direct logger usage for speed
  interceptConsole: true,

  transport: {
    url: process.env.LOKI_URL || 'http://localhost:3100/loki/api/v1/push',
    tenantId: process.env.LOKI_TENANT || 'production',
    authToken: process.env.LOKI_TOKEN,

    // PERFORMANCE OPTIMIZATIONS:

    // 1. Use Snappy (Native C++ compression) + Protobuf
    // This reduces network bandwidth by ~80% compared to JSON
    compression: 'snappy',

    // 2. High concurrency connection pool
    enableConnectionPooling: true,
    maxSockets: 100, // Allow high parallel sending
    timeout: 10000,

    // 3. Use Workers to offload Main Thread (Critical for Node.js event loop)
    useWorkers: true,
    maxWorkers: 4,

    // 4. Batch Settings
    // Only compress if batch is > 4KB to justify overhead
    compressionThreshold: 4096,
    compressionLevel: 6,
  },

  buffer: {
    // Large batches = efficient transmission
    maxSize: 2000,
    // Slightly longer interval to ensure full batches
    flushInterval: 2000,
    maxMemoryMB: 512,
  },

  circuitBreaker: {
    enabled: true,
    failureThreshold: 50, // More tolerant in high traffic
    resetTimeout: 30000,
  },

  deadLetterQueue: {
    enabled: true,
    type: 'file',
    basePath: './.logs-dlq',
  },

  performance: {
    useWorkers: true,
    maxConcurrentFlushes: 10,
  }
});

// Simulate high traffic
console.log('Starting high-volume simulation...');

// ... rest of simulation code ...
const totalLogs = 10000;
for (let i = 0; i < totalLogs; i++) {
  logger.info('High volume event', { index: i, ts: Date.now() });
}
console.log(`Generated ${totalLogs} logs.`);
