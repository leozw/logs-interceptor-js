import { init, logger } from '../src';

/**
 * High-Volume / Extreme Scale Example
 */

init({
  appName: process.env.LOGS_APP_NAME || 'high-volume-service',
  interceptConsole: true,
  transport: {
    url: process.env.LOGS_URL || 'http://localhost:3100/loki/api/v1/push',
    tenantId: process.env.LOGS_TENANT || 'production',
    authToken: process.env.LOGS_TOKEN,
    compression: 'snappy',
    enableConnectionPooling: true,
    maxSockets: 100,
    timeout: 10000,
    useWorkers: true,
    maxWorkers: 4,
    compressionThreshold: 4096,
    compressionLevel: 6,
  },
  buffer: {
    maxSize: 2000,
    flushInterval: 2000,
    maxMemoryMB: 512,
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 50,
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
  },
});

console.log('Starting high-volume simulation...');

const totalLogs = 10000;
for (let i = 0; i < totalLogs; i++) {
  logger.info('High volume event', { index: i, ts: Date.now() });
}
console.log(`Generated ${totalLogs} logs.`);
