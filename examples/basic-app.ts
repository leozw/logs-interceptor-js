import { init } from '../src';

/**
 * Standard Production Usage
 */

init({
  appName: process.env.LOGS_APP_NAME || 'my-service',
  interceptConsole: true,
  transport: {
    url: process.env.LOGS_URL || 'http://localhost:3100/loki/api/v1/push',
    tenantId: process.env.LOGS_TENANT || 'my-tenant',
    authToken: process.env.LOGS_TOKEN,
    compression: 'gzip',
    enableConnectionPooling: true,
  },
  deadLetterQueue: {
    enabled: true,
    type: 'file',
  },
  circuitBreaker: {
    enabled: true,
  },
});

console.log('--- Service Started (Standard Config) ---');
console.info('Processing request', { path: '/api/v1/users', method: 'GET' });
