'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');

async function runPublicConfigGate(api) {
  const records = []; let fatal, getterCalls = 0, providerCalls = 0;
  const server = http.createServer((request, response) => {
    const chunks = []; let bytes = 0;
    request.on('error', () => {});
    request.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) { fatal = 'WIRE_BUDGET'; request.destroy(); } else chunks.push(chunk); });
    request.on('end', () => {
      try { const payload = JSON.parse(Buffer.concat(chunks).toString()); records.push(...payload.streams.flatMap(stream => stream.values.map(row => JSON.parse(row[1])))); response.writeHead(200); }
      catch { fatal = 'WIRE_DECODE'; response.writeHead(500); }
      response.end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/loki/api/v1/push`;
  const base = () => ({ appName: 'config-preflight', silentErrors: true,
    transport: { type: 'loki', url, tenantId: 'synthetic', compression: 'none', useWorkers: false, maxRetries: 0, timeout: 300, sendTimeoutMillis: 1000 },
    buffer: { autoFlush: false }, performance: { shutdownTimeoutMillis: 500 } });
  const selectors = [
    candidate => [candidate, 'transport', candidate.transport],
    candidate => [candidate, 'labels', { ordinary: 'label' }],
    candidate => [candidate.transport, 'url', url],
    candidate => { candidate.labels = {}; return [candidate.labels, 'ordinary', 'label']; },
    candidate => { candidate.filter = {}; return [candidate.filter, 'sanitize', true]; },
    candidate => { candidate.dynamicLabels = {}; return [candidate.dynamicLabels, 'ordinary', () => 'label']; },
  ];
  let rejected = 0;
  try {
    const healthy = api.init(base());
    for (const select of selectors) {
      const candidate = base(), [object, key, value] = select(candidate);
      Object.defineProperty(object, key, { enumerable: true, configurable: true, get() { getterCalls++; return value; } });
      assert.throws(() => api.init(candidate), error => error.message === 'ELVEN_CONFIG_INPUT_BUDGET'); rejected++;
      assert.equal(getterCalls, 0); assert.equal(api.getLogger(), healthy); assert.equal(healthy.getHealth().healthy, true);
    }
    for (const dimension of ['key', 'nodes']) {
      const candidate = Object.create(null);
      if (dimension === 'key') candidate['K'.repeat(16385)] = 'ordinary';
      else for (let index = 0; index < 65; index++) candidate['key_' + index] = 'ordinary';
      Object.defineProperty(candidate, 'transport', { enumerable: true, get() { getterCalls++; return base().transport; } });
      assert.throws(() => api.init(candidate), error => error.message === 'ELVEN_CONFIG_INPUT_BUDGET'); rejected++;
      assert.equal(getterCalls, 0); assert.equal(api.getLogger(), healthy);
    }
    healthy.info('healthy-after-rejection'); await healthy.flush(); assert.equal(records.length, 1);
    assert.equal(records[0].message, 'healthy-after-rejection');
    for (const capacity of [1.5, NaN, Infinity, -Infinity, 0, -1, 10001]) {
      const candidate = base(); candidate.deadLetterQueue = { type: 'memory', enabled: true, maxSize: capacity };
      assert.throws(() => api.init(candidate), error => error.message.includes('deadLetterQueue.maxSize must be a safe integer between 1 and 10000'));
      assert.equal(api.getLogger(), healthy); assert.equal(healthy.getHealth().healthy, true);
    }
    const callback = () => { providerCalls++; return 'stable'; };
    const pattern = /NEVER_MATCH_PREFLIGHT/i; pattern.lastIndex = 17;
    Object.defineProperties(pattern, { source: { get() { getterCalls++; return 'MUST_NOT_READ'; } }, flags: { get() { getterCalls++; return 'g'; } } });
    const config = base(); config.dynamicLabels = Object.freeze({ stable: callback });
    const labels = Object.create(Object.defineProperty({}, 'inherited', { enumerable: true, get() { getterCalls++; return 'ignored'; } }));
    labels.ordinary = 'normal';
    Object.defineProperty(labels, 'metadata', { get() { getterCalls++; return 'ignored'; } });
    Object.defineProperty(labels, Symbol('metadata'), { enumerable: true, get() { getterCalls++; return 'ignored'; } });
    config.labels = Object.freeze(labels); config.filter = Object.freeze({ sensitivePatterns: Object.freeze([pattern]) });
    const callbackDescriptor = Object.getOwnPropertyDescriptor(config.dynamicLabels, 'stable');
    const logger = api.init(config); logger.info('ordinary-normal-config'); await logger.flush();
    assert.equal(records.length, 2); assert.equal(records[1].message, 'ordinary-normal-config');
    assert.equal(getterCalls, 0); assert.equal(providerCalls, 1); assert.equal(pattern.lastIndex, 17);
    assert.equal(config.dynamicLabels.stable, callback); assert.deepEqual(Object.getOwnPropertyDescriptor(config.dynamicLabels, 'stable'), callbackDescriptor);
    assert.equal(config.labels.ordinary, 'normal'); assert.equal(config.transport.url, url); assert.equal(fatal, undefined);
    return { rejected, rejectedDlqCounts: 7, getterCalls, healthyRecords: records.length, providerCalls, callerUnchanged: true, noProxySandboxClaim: true };
  } finally {
    await api.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
module.exports = { runPublicConfigGate };
