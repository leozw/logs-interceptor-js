const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const api = require('../dist');
const { detachedString } = require('../dist/infrastructure/memory/DetachedString');
const { ownedConfiguration, LEGACY_CONFIG_LIMITS } = require('../dist/infrastructure/memory/OwnedConfiguration');
const { boundedSnapshot } = require('../dist/infrastructure/memory/BoundedSnapshot');
const { LogFilter } = require('../dist/infrastructure/filter/LogFilter');
const { ConfigService } = require('../dist/application/services/ConfigService');

const options = url => ({ appName: 'legacy-detachment', transport: { url, tenantId: 'synthetic', compression: 'none', useWorkers: false, maxRetries: 0, timeout: 500 }, buffer: { autoFlush: false }, interceptConsole: false, enableMetrics: false });
async function receiver() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > 262144) req.destroy(); else chunks.push(chunk); });
    req.on('end', () => { requests.push(JSON.parse(Buffer.concat(chunks).toString())); res.writeHead(204); res.end(); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { requests, url: `http://127.0.0.1:${server.address().port}/push`, close: async () => {
    await api.destroy().catch(() => {});
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  } };
}
const rows = payload => payload.streams.flatMap(stream => stream.values.map(([, line]) => ({ labels: stream.stream, entry: JSON.parse(line) })));

test('detached UTF16 primitive preserves code units including lone surrogates and explicit prefix boundaries', () => {
  for (const value of ['ordinary', 'a\ud800b\udc00c', 'x\ud83d\ude00\u00a0\ufeffy', '']) {
    assert.equal(detachedString(value, value.length), value);
    for (let limit = 0; limit <= value.length; limit++) assert.equal(detachedString(value, limit), value.slice(0, limit));
  }
  assert.equal(detachedString('x'.repeat(1_048_577), 2_000_000).length, 1_048_576);
});

test('snapshot copies nested primitive strings and keys without invoking getters, toJSON or mutating caller graphs', () => {
  const key = 'key\ud800'; const value = 'value\udc00'; let invoked = 0;
  const source = { [key]: value, values: [value], toJSON() { invoked++; throw Error('caller method'); } };
  Object.defineProperty(source, 'accessor', { enumerable: true, get() { invoked++; throw Error('caller getter'); } });
  source.self = source;
  const snapshot = boundedSnapshot(source);
  assert.equal(snapshot[key], value); assert.equal(snapshot.values[0], value);
  assert.equal(snapshot.accessor, '[Accessor]'); assert.equal(snapshot.self, '[Circular Reference]');
  assert.equal(invoked, 0); assert.equal(source[key], value); assert.notEqual(snapshot, source);
});

test('legacy config owns DTO keys and strings, preserves provider identity, and accepts values above modern512', () => {
  const fn = () => 'caller-owned-closure'; const value = 'ordinary'.repeat(128);
  const pattern = /ordinary(?:custom)/u;
  const source = { appName: value, labels: { [value]: value }, dynamicLabels: { note: fn }, filter: { patterns: [pattern] } };
  const result = ownedConfiguration(source);
  assert.equal(result.appName, value); assert.equal(result.labels[value], value);
  assert.notEqual(result.labels, source.labels); assert.equal(result.dynamicLabels.note, fn);
  assert.equal(result.filter.patterns[0], pattern); assert.equal(pattern.lastIndex, 0);
  source.labels[value] = 'caller mutation'; assert.equal(result.labels[value], value);
});

test('legacy config budget boundaries are explicit and accessor/cycle rejection is fixed and value-free', () => {
  const { units, nodes, depth } = LEGACY_CONFIG_LIMITS;
  assert.equal(ownedConfiguration({ value: 'x'.repeat(units - 5) }).value.length, units - 5);
  assert.throws(() => ownedConfiguration({ value: 'x'.repeat(units - 4) }), { message: 'ELVEN_LEGACY_CONFIG_BUDGET' });
  assert.equal(Object.keys(ownedConfiguration(Object.fromEntries(Array.from({ length: nodes - 1 }, (_, n) => ['k' + n, ''])))).length, nodes - 1);
  assert.throws(() => ownedConfiguration(Object.fromEntries(Array.from({ length: nodes }, (_, n) => ['k' + n, '']))), { message: 'ELVEN_LEGACY_CONFIG_BUDGET' });
  const nested = n => n === 0 ? 'leaf' : { next: nested(n - 1) };
  assert.ok(ownedConfiguration(nested(depth))); assert.throws(() => ownedConfiguration(nested(depth + 1)), { message: 'ELVEN_LEGACY_CONFIG_BUDGET' });
  let invoked = 0; const getter = {};
  Object.defineProperty(getter, 'synthetic-private-field', { enumerable: true, get() { invoked++; return 'private'; } });
  assert.throws(() => ownedConfiguration(getter), { message: 'ELVEN_LEGACY_CONFIG_UNSUPPORTED' }); assert.equal(invoked, 0);
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => ownedConfiguration(cycle), { message: 'ELVEN_LEGACY_CONFIG_UNSUPPORTED' });
});

test('over-budget reinitialization leaves the previous actual public logger exporting', async () => {
  const target = await receiver();
  try {
    const previous = api.init(options(target.url));
    assert.throws(() => api.init({ ...options(target.url), labels: { note: 'x'.repeat(1_048_576) } }), { message: 'ELVEN_LEGACY_CONFIG_BUDGET' });
    assert.equal(api.getLogger(), previous); assert.equal(previous.getHealth().healthy, true);
    const expanded = { ...options(target.url), labels: Object.fromEntries(Array.from({ length: 470 }, (_, n) => ['k' + n, ''])) };
    assert.doesNotThrow(() => ownedConfiguration(expanded));
    assert.throws(() => ConfigService.resolve(expanded), { message: 'ELVEN_LEGACY_CONFIG_BUDGET' });
    assert.throws(() => api.init(expanded), { message: 'ELVEN_LEGACY_CONFIG_BUDGET' });
    assert.equal(api.getLogger(), previous); assert.equal(previous.getHealth().healthy, true);
    previous.info('previous-still-functional'); await previous.flush();
    assert.equal(rows(target.requests[0])[0].entry.message, 'previous-still-functional');
  } finally { await target.close(); }
});

test('public message limits, default dimensions and explicit correlation indexing survive detachment', async () => {
  const target = await receiver();
  try {
    const note = 'q'.repeat(1024), message = 'q'.repeat(20000), request = 'request-' + 'r'.repeat(1024);
    for (const customLimit of [false, true]) {
      const logger = api.init({ ...options(target.url), version: 'synthetic-version', environment: 'synthetic-env', labels: { note }, filter: { sanitize: false, ...(customLimit ? { maxMessageLength: 32768 } : {}) }, dynamicLabels: { request_id: () => request } });
      logger.info(message, { note: 'okay\ud800\udc00\ud800' }); await logger.flush(); await api.destroy();
      const { entry, labels } = rows(target.requests.at(-1))[0];
      assert.equal(entry.message, customLimit ? message : message.slice(0, 8192) + '...[truncated]');
      assert.equal(entry.context.note, 'okay\ud800\udc00\ud800'); assert.equal(entry.requestId, request);
      assert.equal(labels.request_id, request); assert.equal(labels.note, note);
      assert.equal(labels.app, 'legacy-detachment'); assert.equal(labels.version, 'synthetic-version'); assert.equal(labels.environment, 'synthetic-env');
      assert.equal(typeof labels.hostname, 'string'); assert.equal(typeof labels.pid, 'string');
    }
  } finally { await target.close(); }
});

test('correlation snapshot exhaustion cannot restore original unfiltered IDs through record spread', () => {
  for (const sanitize of [true, false]) {
    const filter = new LogFilter({ levels: ['info'], patterns: [], samplingRate: 1, maxMessageLength: 8192, sanitize, sensitivePatterns: [] });
    try {
      const entry = { id: 'synthetic', timestamp: new Date().toISOString(), level: 'info', message: 'ordinary', traceId: 'q'.repeat(8000), spanId: 'Bearer synthetic-span-private', requestId: 'Bearer synthetic-request-private' };
      const result = filter.filter(entry);
      assert.equal(result.spanId, '[REDACTED]'); assert.equal(result.requestId, '[REDACTED]');
      assert.equal(entry.requestId, 'Bearer synthetic-request-private');
    } finally { filter.close(); }
  }
});
