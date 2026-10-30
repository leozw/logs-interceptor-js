import assert from 'node:assert/strict';
import { before, after, mock, test } from 'node:test';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { retryAfterNotBefore } from '../infrastructure/transport/RetryAfter';
import { ResilientTransport } from '../infrastructure/transport/ResilientTransport';
import { WorkerPool } from '../infrastructure/workers/WorkerPool';
import { GzipCompressor } from '../infrastructure/compression/GzipCompressor';
import { BrotliCompressor } from '../infrastructure/compression/BrotliCompressor';
import type { ILogTransport } from '../domain/interfaces/ILogTransport';
import { ConfigService } from '../application/services/ConfigService';
import { TransportFactory } from '../infrastructure/transport/TransportFactory';
import * as utils from '../utils';
import type { IDeadLetterQueue } from '../domain/interfaces/IDeadLetterQueue';
import { CircuitBreaker } from '../infrastructure/circuit-breaker/CircuitBreaker';

const entries = [{ id: 'retry', timestamp: '', level: 'info' as const, message: 'ordinary' }];
// Product retry/deadline timers are unref'ed; this fixture owns its bounded wait.
let keepAlive: ReturnType<typeof setInterval>;
before(() => { keepAlive = setInterval(() => {}, 1000); });
after(() => clearInterval(keepAlive));
function base(send: ILogTransport['send']): ILogTransport {
  return { send, destroy: async () => {}, isAvailable: async () => true,
    getHealth: () => ({ healthy: true, consecutiveFailures: 0 }), getMetrics: () => undefined };
}

test('Retry-After parsing is bounded, keeps valid fields, and never splits date commas', () => {
  const wall = Date.parse('Wed, 21 Oct 2015 07:28:00 GMT');
  assert.deepEqual(retryAfterNotBefore(undefined, wall, 100), { invalid: false });
  assert.deepEqual(retryAfterNotBefore(['1', 'bad SYNTHETIC_PRIVATE', '60'], wall, 100), { notBefore: 60100, invalid: true });
  assert.deepEqual(retryAfterNotBefore(['Wed, 21 Oct 2015 07:28:02 GMT', '1'], wall, 100), { notBefore: 2100, invalid: false });
  assert.deepEqual(retryAfterNotBefore('Wednesday, 21-Oct-15 07:28:02 GMT', wall, 100), { notBefore: 2100, invalid: false });
  assert.deepEqual(retryAfterNotBefore('Wed Oct 21 07:28:02 2015', wall, 100), { notBefore: 2100, invalid: false });
  assert.deepEqual(retryAfterNotBefore('Wed, 21 Oct 2015 07:27:59 GMT', wall, 100), { notBefore: 100, invalid: false });
  for (const value of ['1,60', '-1', '0.1', '', 'nonsense', 'x'.repeat(129), '\u00a0' + '9'.repeat(64), 'Fri, 31 Feb 2050 00:00:00 GMT', 'Tue, 21 Oct 2015 07:28:02 GMT']) {
    assert.deepEqual(retryAfterNotBefore(value, wall, 100), { invalid: true });
  }
  assert.deepEqual(retryAfterNotBefore('9'.repeat(64), wall, 100), { notBefore: Infinity, invalid: false });
  assert.deepEqual(retryAfterNotBefore(['2', 'x'.repeat(129)], wall, 100), { notBefore: 2100, invalid: true });
  const many = Array(10000).fill('nonsense'); many[0] = '2';
  assert.deepEqual(retryAfterNotBefore(many, wall, 100), { notBefore: 2100, invalid: true });
  const future = Date.UTC(2050, 0, 1), present = Date.UTC(2026, 0, 1);
  assert.deepEqual(retryAfterNotBefore('Saturday, 01-Jan-50 00:00:00 GMT', present, 100), { notBefore: 100 + future - present, invalid: false });
  assert.deepEqual(retryAfterNotBefore('Friday, 01-Jan-00 00:00:00 GMT', Date.UTC(2099, 0, 1), 100), { notBefore: 100 + Date.UTC(2100, 0, 1) - Date.UTC(2099, 0, 1), invalid: false });
  assert.deepEqual(retryAfterNotBefore('Friday, 31-Dec-76 23:59:59 GMT', present, 100), { notBefore: 100, invalid: false });
});

test('a long valid floor declines current and subsequent calls even maxRetries zero, never sleeping sixty seconds', async () => {
  let calls = 0;
  const sink = new ResilientTransport(base(async (_entries, _signal, observe) => {
    calls++; observe?.(performance.now() + 60000, false);
    throw Object.assign(new Error('status'), { statusCode: 429 });
  }), { maxRetries: 0, retryDelay: 1, sendTimeoutMillis: 100 });
  try {
    await assert.rejects(sink.send(entries), /ELVEN_RETRY_AFTER_DECLINED/);
    await assert.rejects(sink.send(entries), /ELVEN_RETRY_AFTER_DECLINED/);
    assert.equal(calls, 1); assert.equal(sink.getMetrics()?.backpressureDeclines, 2);
    assert.equal(sink.getMetrics()?.failedSends, 2); assert.equal(sink.getMetrics()?.retryAttempts, 0);
  } finally { await sink.destroy(); }
});

test('malformed headers do not park future delivery; valid floors expire naturally across sends', async () => {
  let calls = 0;
  const sink = new ResilientTransport(base(async (_entries, _signal, observe) => {
    if (++calls === 1) { observe?.(undefined, true); throw Object.assign(new Error('429'), { statusCode: 429 }); }
  }), { maxRetries: 0, retryDelay: 0, sendTimeoutMillis: 500 });
  try { await assert.rejects(sink.send(entries)); await sink.send(entries); assert.equal(calls, 2); }
  finally { await sink.destroy(); }
  calls = 0;
  let floor = 0;
  const expiring = new ResilientTransport(base(async (_entries, _signal, observe) => {
    if (++calls === 1) { floor = performance.now() + 70; observe?.(floor, false); throw Object.assign(new Error('429'), { statusCode: 429 }); }
    assert.ok(performance.now() >= floor);
  }), { maxRetries: 0, sendTimeoutMillis: 30 });
  try {
    await assert.rejects(expiring.send(entries), /DECLINED/);
    await assert.rejects(expiring.send(entries), /DECLINED/);
    await delay(85); await expiring.send(entries); assert.equal(calls, 2);
  } finally { await expiring.destroy(); }
});

test('concurrent sends recheck raised floor and operation deadline never destroys another call', async () => {
  const starts: number[] = [];
  let first = true;
  const sink = new ResilientTransport(base(async (_entries, signal, observe) => {
    starts.push(performance.now());
    if (first) { first = false; observe?.(performance.now() + 60, false); throw Object.assign(new Error('503'), { statusCode: 503 }); }
    await delay(5, undefined, { signal });
  }), { maxRetries: 0, sendTimeoutMillis: 300 });
  try {
    await assert.rejects(sink.send(entries));
    await Promise.all([sink.send(entries), sink.send(entries)]);
    assert.equal(starts.length, 3); assert.ok(starts[1] - starts[0] >= 60);
  } finally { await sink.destroy(); }
  let destroys = 0;
  const raw = base(async (records, signal) => { await delay(records[0].id === 'slow' ? 1000 : 5, undefined, { signal }); });
  raw.destroy = async () => { destroys++; };
  const deadlines = new ResilientTransport(raw, { maxRetries: 0, sendTimeoutMillis: 40 });
  const slow = deadlines.send([{ ...entries[0], id: 'slow' }]).catch(error => error);
  try {
    await deadlines.send(entries); assert.match((await slow).message, /ELVEN_SEND_DEADLINE/);
    await deadlines.send(entries); assert.equal(destroys, 0); assert.equal(deadlines.getMetrics()?.deadlineExceeded, 1);
  } finally { await deadlines.destroy(); }
  assert.equal(destroys, 1);
});

test('destroy cancels only owned waits promptly, without another request or an unbounded timer', async () => {
  let calls = 0;
  const sink = new ResilientTransport(base(async (_entries, _signal, observe) => {
    calls++; observe?.(performance.now() + 1000, false); throw Object.assign(new Error('503'), { statusCode: 503 });
  }), { maxRetries: 1, retryDelay: 0, sendTimeoutMillis: 2000 });
  const pending = sink.send(entries).catch(error => error);
  await delay(10); await sink.destroy(); assert.match((await pending).message, /closed/); assert.equal(calls, 1);
});

test('Worker cancellation removes queued work and terminates only the cancelled active Worker before settling', async () => {
  const pool = new WorkerPool({ maxWorkers: 2, maxQueueSize: 2, taskTimeout: 1000, workerScript: join(__dirname, 'fixtures/worker.cjs') });
  const cancelled = new AbortController();
  const active = pool.execute('process', 'hang', undefined, cancelled.signal).catch(error => error);
  try {
    const other = pool.execute<{ data: string }>('process', 'ordinary');
    cancelled.abort(new Error('OWN_OPERATION_CANCELLED'));
    assert.equal((await active).message, 'OWN_OPERATION_CANCELLED');
    assert.equal((await other).data, 'ordinary');
    assert.equal(pool.getMetrics().activeWorkers, 0);
    const futureA = pool.execute('process', 'hang').catch(error => error);
    const futureB = pool.execute('process', 'hang').catch(error => error);
    assert.equal(pool.getMetrics().activeWorkers, 2);
    await pool.destroy(); await Promise.all([futureA, futureB]);
  } finally { await pool.destroy(); }
  const single = new WorkerPool({ maxWorkers: 1, maxQueueSize: 2, taskTimeout: 1000, workerScript: join(__dirname, 'fixtures/worker.cjs') });
  try {
    const queuedSignal = new AbortController();
    const blocker = single.execute('process', 'hang').catch(error => error);
    const queued = single.execute('process', 'queued', undefined, queuedSignal.signal).catch(error => error);
    assert.equal(single.getMetrics().queueLength, 1);
    queuedSignal.abort(new Error('QUEUED_CANCELLED'));
    assert.equal((await queued).message, 'QUEUED_CANCELLED');
    await single.destroy(); await blocker;
  } finally { await single.destroy(); }
});

test('gzip/brotli operation abort settles the owned compression stream without fallback', async () => {
  for (const compressor of [new GzipCompressor(), new BrotliCompressor()]) {
    const controller = new AbortController();
    const pending = compressor.compress(Buffer.alloc(1024 * 1024, 97), controller.signal);
    controller.abort(new Error('OWN_COMPRESSION_CANCELLED'));
    await assert.rejects(pending, /OWN_COMPRESSION_CANCELLED/);
    assert.ok((await compressor.compress('ordinary')).length > 0);
  }
});

test('invalid Retry-After diagnostics are fixed, rate-limited and do not prevent successful retry', async () => {
  const warnings: unknown[][] = [];
  const warning = mock.method(utils, 'internalWarn', (...values: unknown[]) => { warnings.push(values); });
  let calls = 0;
  const sink = new ResilientTransport(base(async (_entries, _signal, observe) => {
    if (++calls <= 3) { observe?.(undefined, true); throw Object.assign(new Error('429'), { statusCode: 429 }); }
  }), { maxRetries: 3, retryDelay: 0, sendTimeoutMillis: 2000 });
  try {
    await sink.send(entries); assert.equal(calls, 4);
    assert.deepEqual(warnings, [['ELVEN_INVALID_RETRY_AFTER']]);
  } finally { warning.mock.restore(); await sink.destroy(); }
});

test('terminal failed-entry accounting distinguishes DLQ retention and local unretained data', async () => {
  const dlq = { addBatch: async () => ({ added: 1, dropped: 1 }) } as unknown as IDeadLetterQueue;
  const sink = new ResilientTransport(base(async (_entries, _signal, observe) => {
    observe?.(performance.now() + 60000, false); throw Object.assign(new Error('429'), { statusCode: 429 });
  }), { maxRetries: 1, sendTimeoutMillis: 100 }, undefined, dlq);
  try {
    await assert.rejects(sink.send([...entries, { ...entries[0], id: 'two' }]), /DECLINED/);
    const metrics = sink.getMetrics();
    assert.equal(metrics?.failedSendEntries, 2); assert.equal(metrics?.dlqEnqueuedEntries, 1);
    assert.equal(metrics?.unretainedSendEntries, 1); assert.equal(metrics?.dlqDroppedEntries, 1);
  } finally { await sink.destroy(); }
});

test('actual JSON, protobuf and OTLP request cancellation is operation-local and future sends recover', async () => {
  for (const compression of ['none', 'snappy', 'otlp'] as const) {
    let arrived!: () => void;
    const arrival = new Promise<void>(resolve => { arrived = resolve; });
    let requests = 0, aborted = 0;
    const server = createServer((req, res) => {
      req.resume(); req.once('end', () => {
        if (++requests === 1) { res.once('close', () => { if (!res.writableEnded) aborted++; }); arrived(); }
        else { res.writeHead(200); res.end(); }
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const config = ConfigService.resolve({ appName: 'cancel-wire', transport: {
      type: compression === 'otlp' ? 'otlp' : 'loki', tenantId: 'audit', url: `http://127.0.0.1:${address.port}/push`,
      compression: compression === 'otlp' ? 'none' : compression, timeout: 5000, sendTimeoutMillis: 250, maxRetries: 0,
    }, buffer: { autoFlush: false } });
    const sink = TransportFactory.create(config);
    const record = { ...entries[0], timestamp: new Date().toISOString() };
    const slow = sink.send([record]).catch(error => error);
    try {
      await arrival;
      await sink.send([{ ...record, id: 'healthy' }]);
      assert.match((await slow).message, /ELVEN_SEND_DEADLINE/);
      await sink.send([{ ...record, id: 'future' }]); await delay(10);
      assert.equal(requests, 3); assert.equal(aborted, 1);
      assert.equal(sink.getMetrics()?.successfulSends, 2); assert.equal(sink.getMetrics()?.failedSends, 1);
    } finally {
      await sink.destroy(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
});

test('suppressed backpressure calls do not reopen a circuit or outlive the naturally expiring floor', async () => {
  const circuit = new CircuitBreaker({ enabled: true, failureThreshold: 1, resetTimeout: 10000, halfOpenRequests: 1 });
  let calls = 0;
  const sink = new ResilientTransport(base(async (_entries, _signal, observe) => {
    if (++calls === 1) { observe?.(performance.now() + 75, false); throw Object.assign(new Error('429'), { statusCode: 429 }); }
  }), { maxRetries: 0, sendTimeoutMillis: 10 }, circuit);
  try {
    for (let index = 0; index < 5; index++) await assert.rejects(sink.send(entries), /DECLINED/);
    assert.equal(circuit.getState().failures, 0); assert.equal(circuit.getState().state, 'closed');
    assert.equal(sink.getHealth().healthy, false); assert.equal(sink.getHealth().circuitBreakerState, 'closed');
    await delay(90); await sink.send(entries); assert.equal(calls, 2); assert.equal(sink.getHealth().healthy, true);
  } finally { await sink.destroy(); }
});
