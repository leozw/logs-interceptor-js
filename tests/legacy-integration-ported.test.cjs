const assert = require('node:assert/strict');
const { test: registerTest } = require('node:test');
const http = require('node:http');
const { init, getLogger, destroy } = require('../dist');

let url;
function test(name, body) {
  registerTest(name, async () => {
    const server = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => { res.writeHead(503); res.end(); });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}/loki/api/v1/push`;
    try { await body(); } finally {
      await destroy().catch(() => {});
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    }
  });
}
const transport = () => ({ url, tenantId: 'test', useWorkers: false, timeout: 50, maxRetries: 0 });

test('ported Initialization: should initialize with valid config', () => {
  const instance = init({ transport: { ...transport(), tenantId: 'test-tenant', authToken: 'synthetic-test-token' }, appName: 'test-app', environment: 'test' });
  assert.notEqual(instance, undefined);
  assert.equal(getLogger(), instance);
});

test('ported Initialization: should throw error with invalid config', () => {
  assert.throws(() => init({ transport: { ...transport(), url: '' }, appName: 'test' }));
});

test('ported Logging: should log messages at different levels', () => {
  const instance = init({ transport: transport(), appName: 'test', interceptConsole: false });
  assert.doesNotThrow(() => {
    instance.debug('Debug message');
    instance.info('Info message');
    instance.warn('Warning message');
    instance.error('Error message');
    instance.fatal('Fatal message');
  });
});

test('ported Logging: should track events', () => {
  const instance = init({ transport: transport(), appName: 'test', interceptConsole: false });
  assert.doesNotThrow(() => instance.trackEvent('user_login', { userId: '123' }));
});

test('ported Flush: should flush logs', async () => {
  const instance = init({ transport: transport(), appName: 'test', interceptConsole: false, buffer: { maxSize: 10, flushInterval: 1000 } });
  instance.info('Test log');
  await assert.rejects(instance.flush());
});

test('ported Metrics and Health: should return metrics', () => {
  const instance = init({ transport: transport(), appName: 'test', interceptConsole: false });
  const metrics = instance.getMetrics();
  assert.notEqual(metrics, undefined);
  assert.ok(metrics.logsProcessed >= 0);
  assert.ok(metrics.bufferSize >= 0);
});

test('ported Metrics and Health: should return health status', () => {
  const instance = init({ transport: transport(), appName: 'test', interceptConsole: false });
  const health = instance.getHealth();
  assert.notEqual(health, undefined);
  assert.equal(typeof health.healthy, 'boolean');
  assert.ok(health.uptime >= 0);
});

test('ported Features: should support Brotli compression', () => {
  const instance = init({ transport: { ...transport(), compression: 'brotli', compressionLevel: 4 }, appName: 'test', interceptConsole: false });
  assert.notEqual(instance, undefined);
});

test('ported Features: should support Gzip compression', () => {
  const instance = init({ transport: { ...transport(), compression: 'gzip' }, appName: 'test', interceptConsole: false });
  assert.notEqual(instance, undefined);
});

test('ported Features: should support connection pooling', () => {
  const instance = init({ transport: { ...transport(), enableConnectionPooling: true }, appName: 'test', interceptConsole: false });
  assert.notEqual(instance, undefined);
});

test('ported Features: should support circuit breaker', () => {
  const instance = init({ transport: transport(), appName: 'test', interceptConsole: false, circuitBreaker: { enabled: true, failureThreshold: 5, resetTimeout: 60000 } });
  assert.notEqual(instance, undefined);
});

test('ported Features: should support Dead Letter Queue', () => {
  const instance = init({ transport: transport(), appName: 'test', interceptConsole: false, deadLetterQueue: { enabled: true, type: 'memory', maxSize: 1000 } });
  assert.notEqual(instance, undefined);
});
