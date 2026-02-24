import { init, logger } from '../src';

/**
 * Event Tracking Example
 */

init({
  appName: process.env.LOGS_APP_NAME || 'analytics-service',
  interceptConsole: true,
  transport: {
    url: process.env.LOGS_URL || 'http://localhost:3100/loki/api/v1/push',
    tenantId: process.env.LOGS_TENANT || 'analytics',
    authToken: process.env.LOGS_TOKEN,
  },
});

console.log('--- Starting Analytics Job ---');

logger.trackEvent('user_signup', {
  userId: 'u_123456',
  plan: 'pro',
  referral: 'google_ads',
  value: 29.99,
});

logger.trackEvent('batch_process_completed', {
  batchId: 'b_999',
  recordsProcessed: 1500,
  durationMs: 345,
  successRate: 0.99,
});

try {
  throw new Error('Payment Gateway Timeout');
} catch (error) {
  logger.trackEvent('payment_failed', {
    reason: error instanceof Error ? error.message : 'Unknown',
    gateway: 'stripe',
    amount: 100,
  });
}

logger.trackEvent('api_request', {
  endpoint: '/api/v1/users',
  method: 'GET',
  statusCode: 200,
  requestId: 'req_abc123',
});

setTimeout(() => {
  console.log('Exiting...');
  process.exit(0);
}, 1000);
