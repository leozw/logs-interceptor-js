const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const api = require('../dist');
const { ConfigService } = require('../dist/application/services/ConfigService');
const { MemoryDeadLetterQueue } = require('../dist/infrastructure');

const options = url => ({ appName: 'legacy-admission', transport: { url, tenantId: 'synthetic', compression: 'none', useWorkers: false, maxRetries: 0, timeout: 500 }, buffer: { autoFlush: false }, interceptConsole: false, enableMetrics: false });
const rows = requests => requests.flatMap(payload => payload.streams.flatMap(stream => stream.values.map(([, line]) => ({ labels: stream.stream, entry: JSON.parse(line) }))));
async function receiver() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > 65536) req.destroy(); else chunks.push(chunk); });
    req.on('end', () => { requests.push(JSON.parse(Buffer.concat(chunks).toString())); res.writeHead(204); res.end(); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { requests, url: `http://127.0.0.1:${server.address().port}/push`, close: async () => {
    await api.destroy().catch(() => {});
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  } };
}

test('L3-IR01 root admission rejects root and nested getters without invoking them and preserves the actual previous logger', async () => {
  const target = await receiver();
  try {
    const previous = api.init(options(target.url));
    let invoked = 0;
    for (const site of ['root', 'labels', 'transport', 'filter', 'dynamicLabels', 'pattern']) for (const throwing of [false, true]) {
      const config = options(target.url);
      const pattern = /ordinary(?:custom)/u;
      const value = site === 'root' ? config : site === 'transport' ? config.transport : site === 'pattern' ? pattern : (config[site] = {});
      if (site === 'pattern') config.filter = { patterns: [pattern] };
      const key = site === 'root' ? 'labels' : site === 'transport' ? 'url' : site === 'filter' ? 'sanitize' : 'note';
      const get = () => { invoked++; if (throwing) throw Error('synthetic caller getter'); return site === 'root' ? {} : 'synthetic-value'; };
      Object.defineProperty(value, key, { enumerable: true, configurable: true, get });
      assert.throws(() => api.init(config), { message: 'ELVEN_LEGACY_CONFIG_UNSUPPORTED' });
      assert.equal(invoked, 0);
      assert.equal(Object.getOwnPropertyDescriptor(value, key).get, get);
      assert.equal(api.getLogger(), previous);
      assert.equal(previous.getHealth().healthy, true);
    }
    for (const invalid of [null, [], /ordinary/, Object.assign(() => {}, options(target.url))]) {
      assert.throws(() => api.init(invalid), { message: 'ELVEN_LEGACY_CONFIG_UNSUPPORTED' });
      assert.equal(api.getLogger(), previous);
    }
    previous.info('healthy-after-getter-rejections'); await previous.flush();
    assert.equal(rows(target.requests)[0].entry.message, 'healthy-after-getter-rejections');
  } finally { await target.close(); }
});

test('L3-IR01 root caller budget rejects before merge and leaves caller descriptors and the prior logger intact', async () => {
  const target = await receiver();
  try {
    const previous = api.init(options(target.url));
    const labels = Object.fromEntries(Array.from({ length: 501 }, (_, n) => ['field' + n, 'tiny']));
    const config = { ...options(target.url), labels };
    assert.throws(() => api.init(config), { message: 'ELVEN_LEGACY_CONFIG_BUDGET' });
    assert.equal(Object.keys(labels).length, 501); assert.equal(labels.field500, 'tiny');
    assert.equal(api.getLogger(), previous);
    previous.info('healthy-after-caller-budget'); await previous.flush();
    assert.equal(rows(target.requests)[0].entry.message, 'healthy-after-caller-budget');
  } finally { await target.close(); }
});

test('L3-IR01 ordinary provider functions retain identity and caller state and are only invoked for actual records', async () => {
  const target = await receiver();
  try {
    let calls = 0; const provider = () => { calls++; return 'synthetic-provider'; };
    const pattern = /never-match-this(?:custom)/u;
    const config = { ...options(target.url), labels: { note: 'caller-label' }, dynamicLabels: { lane: provider }, filter: { patterns: [pattern] } };
    const resolved = ConfigService.resolve(config);
    assert.equal(resolved.dynamicLabels.lane, provider); assert.equal(calls, 0);
    const logger = api.init(config); assert.equal(calls, 0);
    config.labels.note = 'caller-mutation';
    // Remove the selector through a new ordinary DTO so this record is admitted.
    await api.destroy();
    const admitted = { ...options(target.url), labels: { note: 'caller-label' }, dynamicLabels: config.dynamicLabels };
    const active = api.init(admitted); assert.equal(calls, 0);
    active.info('provider-record'); await active.flush();
    assert.equal(calls, 1); assert.equal(rows(target.requests)[0].labels.lane, 'synthetic-provider');
    assert.equal(config.dynamicLabels.lane, provider); assert.equal(config.filter.patterns[0], pattern);
    assert.equal(pattern.lastIndex, 0); assert.equal(config.labels.note, 'caller-mutation');
    assert.notEqual(logger, active);
  } finally { await target.close(); }
});

const envCases = [[undefined, true], ['', true], ['true', true], ['TRUE', true], ['false', false], ['FALSE', false], ['invalid-boolean', true], [' false ', true], ['0', true]];
const canary = 'Bearer synthetic-sanitize-canary';
async function environmentWire(preload) {
  const target = await receiver();
  const values = { LOGS_INTERCEPTOR_URL: target.url, LOGS_INTERCEPTOR_TENANT_ID: 'synthetic', LOGS_INTERCEPTOR_APP_NAME: 'legacy-env-admission', LOGS_INTERCEPTOR_COMPRESSION: 'none', LOGS_INTERCEPTOR_USE_WORKERS: 'false', LOGS_INTERCEPTOR_MAX_RETRIES: '0', LOGS_INTERCEPTOR_TIMEOUT: '500', LOGS_INTERCEPTOR_AUTO_FLUSH: 'false', LOGS_INTERCEPTOR_INTERCEPT_CONSOLE: 'false', LOGS_INTERCEPTOR_DLQ_ENABLED: 'false' };
  const keys = [...Object.keys(values), 'LOGS_INTERCEPTOR_SANITIZE'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const preloadPath = require.resolve('../preload.js');
  const priorMarker = global.__LOGS_INTERCEPTOR_PRELOADED;
  try {
    Object.assign(process.env, values);
    for (const [value, enabled] of envCases) {
      await api.destroy();
      if (value === undefined) delete process.env.LOGS_INTERCEPTOR_SANITIZE; else process.env.LOGS_INTERCEPTOR_SANITIZE = value;
      if (preload) {
        delete require.cache[preloadPath]; delete global.__LOGS_INTERCEPTOR_PRELOADED;
        require(preloadPath);
        assert.equal(api.isInitialized(), true);
      } else api.init(options(target.url));
      api.logger.info(canary); await api.logger.flush();
      assert.equal(rows(target.requests).at(-1).entry.message, enabled ? '[REDACTED]' : canary);
    }
  } finally {
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    delete require.cache[preloadPath];
    if (priorMarker === undefined) delete global.__LOGS_INTERCEPTOR_PRELOADED; else global.__LOGS_INTERCEPTOR_PRELOADED = priorMarker;
    await target.close();
  }
}
test('L3-IR02 actual root environment wire fails closed for malformed sanitize values and retains explicit false', async () => environmentWire(false));
test('L3-IR02 actual preload environment wire uses the same boolean policy including explicit false', async () => environmentWire(true));

const invalidCapacities = [NaN, Infinity, -Infinity, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, '1000'];
test('L3-IR03 public memory DLQ rejects malformed capacities and bounds 1002 tiny entries with default and explicit normal caps', async () => {
  for (const value of invalidCapacities) assert.throws(() => new MemoryDeadLetterQueue(value), { message: 'ELVEN_LEGACY_DLQ_CAPACITY' });
  const entries = Array.from({ length: 1002 }, (_, n) => ({ id: 'tiny-' + n, timestamp: '2026-10-30T00:00:00.000Z', level: 'info', message: 'tiny' }));
  for (const capacity of [undefined, 3, 1000]) {
    const dlq = capacity === undefined ? new MemoryDeadLetterQueue() : new MemoryDeadLetterQueue(capacity);
    await dlq.addBatch(entries, 'synthetic-failure');
    const expected = capacity ?? 1000;
    assert.equal(dlq.size(), expected);
    assert.equal((await dlq.getEntries())[0].entry.id, 'tiny-' + (1002 - expected));
    assert.equal(entries.length, 1002); assert.equal(entries[0].id, 'tiny-0');
    assert.equal(await dlq.flush(), expected); assert.equal(dlq.size(), 0);
  }
  assert.equal(new MemoryDeadLetterQueue(Number.MAX_SAFE_INTEGER).size(), 0);
});

test('L3-IR03 actual root rejects nonfinite or noninteger memory DLQ capacity without retiring its healthy logger', async () => {
  const target = await receiver();
  try {
    const previous = api.init({ ...options(target.url), deadLetterQueue: { type: 'memory', maxSize: 1000 } });
    for (const value of invalidCapacities) {
      assert.throws(() => api.init({ ...options(target.url), deadLetterQueue: { enabled: true, type: 'memory', maxSize: value } }), { message: 'Configuration errors:\nELVEN_LEGACY_DLQ_CAPACITY' });
      assert.equal(api.getLogger(), previous); assert.equal(previous.getHealth().healthy, true);
    }
    previous.info('healthy-after-invalid-dlq'); await previous.flush();
    assert.equal(rows(target.requests)[0].entry.message, 'healthy-after-invalid-dlq');
  } finally { await target.close(); }
});
