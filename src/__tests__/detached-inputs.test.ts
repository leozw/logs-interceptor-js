import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { destroy, getLogger, init } from '../index';
import { configSnapshot } from '../application/config/ConfigSnapshot';
import { boundedSnapshot } from '../infrastructure/memory/BoundedSnapshot';
import { detachedIdentifier, detachedString } from '../infrastructure/memory/DetachedString';
import { LogFilter } from '../infrastructure/filter/LogFilter';

afterEach(async () => { await destroy(); });

test('detached bounded strings preserve all UTF-16 code units before privacy validation', () => {
  const original = 'A\ud800B\udc00C\ud83d\ude00\u00a0\ufeff';
  assert.equal(detachedString(original, original.length), original);
  assert.equal(detachedString(original, 6), original.slice(0, 6));
  assert.equal(detachedString(original, 0), '');
  assert.equal(original.charCodeAt(1), 0xd800);
  assert.equal(original.charCodeAt(3), 0xdc00);
});

test('snapshot text, nested values, array items and keys preserve callers without accessors', () => {
  let accessed = 0;
  const source = { ordinary: 'safe-\ud83d\ude00', nested: ['\ud800', '\udc00'], key: 'value' };
  Object.defineProperty(source, 'getter', { enumerable: true, get() { accessed++; return 'private'; } });
  const snapshot = boundedSnapshot(source) as Record<string, unknown>;
  assert.equal(snapshot.ordinary, source.ordinary);
  assert.deepEqual(snapshot.nested, source.nested);
  assert.equal(snapshot.getter, '[Accessor]');
  assert.equal(accessed, 0);
  assert.notEqual(snapshot.nested, source.nested);
  assert.equal(source.nested[0].charCodeAt(0), 0xd800);
});

test('configuration snapshot owns maps and pattern objects without changing caller state', () => {
  let invoked = 0;
  const pattern = /ordinary/gu;
  pattern.lastIndex = 19;
  Object.defineProperty(pattern, 'test', { value() { invoked++; throw new Error('must not execute'); } });
  Object.freeze(pattern);
  const provider = () => 'dynamic';
  const source = Object.freeze({ appName: 'name-\ud83d\ude00', labels: Object.freeze({ ordinary: '\ud800' }), transport: Object.freeze({ url: 'http://localhost', headers: Object.freeze({ example: 'synthetic' }) }), filter: Object.freeze({ patterns: Object.freeze([pattern]) }), dynamicLabels: Object.freeze({ example: provider }) });
  const copied = configSnapshot(source);
  assert.notEqual(copied, source);
  assert.notEqual(copied.labels, source.labels);
  assert.notEqual(copied.transport.headers, source.transport.headers);
  assert.notEqual(copied.filter.patterns[0], pattern);
  assert.equal(copied.filter.patterns[0].source, pattern.source);
  assert.equal(copied.dynamicLabels.example, provider);
  assert.equal(copied.labels.ordinary.charCodeAt(0), 0xd800);
  assert.equal(pattern.lastIndex, 19);
  assert.equal(invoked, 0);
});

test('configuration snapshot permits repeated objects but rejects cycles and accessors with fixed diagnostics', () => {
  const shared = { value: 'ordinary' };
  const copied = configSnapshot({ first: shared, second: shared });
  assert.equal(copied.first.value, 'ordinary'); assert.equal(copied.second.value, 'ordinary');
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  assert.throws(() => configSnapshot(cyclic), { message: 'ELVEN_CONFIG_INPUT_BUDGET' });
  let invoked = 0;
  const accessor = Object.defineProperty({}, 'value', { enumerable: true, get() { invoked++; throw new Error('SYNTHETIC_HIDDEN_SOURCE'); } });
  assert.throws(() => configSnapshot(accessor), { message: 'ELVEN_CONFIG_INPUT_BUDGET' });
  assert.equal(invoked, 0);
});

test('bounded configuration rejects oversized transport values before retiring an active runtime', () => {
  const active = init({ appName: 'active', transport: { type: 'otlp', url: 'http://127.0.0.1:9' }, buffer: { autoFlush: false } });
  assert.throws(() => init({ appName: 'new', transport: { type: 'otlp', url: 'http://localhost', headers: { authorization: 'SYNTHETIC_' + 'x'.repeat(16384) } } }), { message: 'ELVEN_CONFIG_INPUT_BUDGET' });
  assert.equal(getLogger(), active);
  assert.equal(active.getHealth().privacyDiagnostics?.length, 0);
});

test('configuration string and container budgets accept exact boundaries and reject excess', () => {
  const full = 'x'.repeat(16384);
  const exact = { a: full, b: full, c: full, d: 'x'.repeat(16380) };
  assert.deepEqual(configSnapshot(exact), Object.assign(Object.create(null), exact));
  assert.throws(() => configSnapshot({ ...exact, d: full }), { message: 'ELVEN_CONFIG_INPUT_BUDGET' });
  assert.throws(() => configSnapshot({ a: 'x'.repeat(16385) }), { message: 'ELVEN_CONFIG_INPUT_BUDGET' });
  assert.equal(configSnapshot(Array.from({ length: 64 }, () => true)).length, 64);
  assert.throws(() => configSnapshot(Array.from({ length: 65 }, () => true)), { message: 'ELVEN_CONFIG_INPUT_BUDGET' });
  const entries = Object.fromEntries(Array.from({ length: 64 }, (_, index) => ['key_' + index, true]));
  assert.equal(Object.keys(configSnapshot(entries)).length, 64);
  assert.throws(() => configSnapshot({ ...entries, extra: true }), { message: 'ELVEN_CONFIG_INPUT_BUDGET' });
});

test('configuration node, depth and callback budgets cannot be bypassed by nested containers', () => {
  const nodes = Array.from({ length: 64 }, (_, index) => Object.fromEntries(Array.from({ length: index === 63 ? 6 : 7 }, (_, field) => ['value_' + field, field])));
  assert.equal(configSnapshot(nodes).length, 64);
  assert.throws(() => configSnapshot(nodes.map((node, index) => index === 63 ? { ...node, value_6: 6 } : node)), { message: 'ELVEN_CONFIG_INPUT_BUDGET' });
  let tree: unknown = 'leaf'; for (let i = 0; i < 8; i++) tree = { value: tree };
  assert.ok(configSnapshot(tree));
  assert.throws(() => configSnapshot({ value: tree }), { message: 'ELVEN_CONFIG_INPUT_BUDGET' });
  assert.throws(() => configSnapshot({ callback: () => undefined }), { message: 'ELVEN_CONFIG_INPUT_BUDGET' });
});

test('correlation identifier copies preserve valid values and bound oversized invalid values', () => {
  const traceId = 'ab'.repeat(16), spanId = 'cd'.repeat(8), requestId = 'request-\ud83d\ude00';
  const filter = new LogFilter({ levels: ['info'], patterns: [], samplingRate: 1, maxMessageLength: 8192, maxContextBytes: 16384, sanitize: false, sensitivePatterns: [] });
  try {
    const input = Object.freeze({ id: 'id', timestamp: '2026-10-29', level: 'info' as const, message: 'ordinary', traceId, spanId, requestId });
    const copied = filter.filter(input);
    assert.equal(copied.traceId, traceId); assert.equal(copied.spanId, spanId); assert.equal(copied.requestId, requestId);
    assert.equal(detachedIdentifier(undefined), undefined);
    assert.equal(detachedIdentifier('x'.repeat(9000))?.length, 8192 + '...[truncated]'.length);
    assert.equal(input.requestId, requestId);
  } finally { filter.close(); }
});
