import { init, logger } from '../src';

/**
 * Event Tracking Example
 * Demonstrates how to use trackEvent for business analytics or specific milestones.
 */

init({
  appName: 'analytics-service',
  interceptConsole: true, // Good practice to always enable this
  transport: {
    url: process.env.LOKI_URL || 'http://localhost:3100/loki/api/v1/push',
    tenantId: 'analytics',
  }
});

console.log('--- Starting Analytics Job ---');

// 1. Track specific business events
// These are useful for calculating metrics later in Grafana (e.g., "Signups per hour")
logger.trackEvent('user_signup', {
  userId: 'u_123456',
  plan: 'pro',
  referral: 'google_ads',
  value: 29.99
});

console.log('User signed up, event tracked.');

// 2. Track system milestones
logger.trackEvent('batch_process_completed', {
  batchId: 'b_999',
  recordsProcessed: 1500,
  durationMs: 345,
  successRate: 0.99
});

console.log('Batch processed, metrics tracked.');

// 3. Track errors as events (if you want to aggregate them differently than logs)
try {
  throw new Error('Payment Gateway Timeout');
} catch (error) {
  logger.trackEvent('payment_failed', {
    reason: error instanceof Error ? error.message : 'Unknown',
    gateway: 'stripe',
    amount: 100
  });
}

// 4. Using trackEvent with High Cardinality data
// Be careful not to use highly unique values (like UUIDs) as *keys* in the properties object.
// Values can be high cardinality, keys should be static.
logger.trackEvent('api_request', {
  endpoint: '/api/v1/users',
  method: 'GET',
  statusCode: 200,
  // 'requestId' is high cardinality, good as a value property
  requestId: 'req_abc123'
});

// Wait for flush
setTimeout(() => {
  console.log('Exiting...');
  process.exit(0);
}, 1000);
