import { init } from '../src';

/**
 * Standard Production Usage
 * Best for most applications (API services, background workers).
 * Balances performance and resource usage.
 */

init({
  appName: process.env.APP_NAME || 'my-service',

  // CRITICAL: Enables capturing console.log/info/warn/error
  interceptConsole: true,

  transport: {
    url: process.env.LOKI_URL || 'http://localhost:3100/loki/api/v1/push',
    tenantId: 'my-tenant',
    authToken: process.env.LOKI_TOKEN,

    // Standard Production Tuning:
    // Gzip is universally compatible and provides good compression/CPU balance
    compression: 'gzip',
    enableConnectionPooling: true, // Reuse connections (important for Node.js)
  },

  // Resilience is key even for basic production apps
  deadLetterQueue: {
    enabled: true,
    type: 'file', // Saves to ./.logs-dlq if network fails
  },

  circuitBreaker: {
    enabled: true, // Prevents cascading failures
  }
});

console.log('--- Service Started (Standard Config) ---');

// Usage is the same...
console.info('Processing request', { path: '/api/v1/users', method: 'GET' });

// ...
