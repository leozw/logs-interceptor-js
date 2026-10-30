const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const api = require('../dist');
const { parseRetryAfter, RetryGate, RetryAfterError, sendScope, RETRY_CODES } = require('../dist/infrastructure/transport/RetryPolicy');
const { LokiJsonTransport } = require('../dist/infrastructure/transport/LokiJsonTransport');
const { LokiProtobufTransport } = require('../dist/infrastructure/transport/LokiProtobufTransport');
const { ResilientTransport } = require('../dist/infrastructure/transport/ResilientTransport');
const { WorkerPool } = require('../dist/infrastructure/workers/WorkerPool');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const entry = message => ({ id: 'synthetic', timestamp: new Date().toISOString(), level: 'info', message, labels: { app: 'synthetic' } });
const config = (url, compression) => ({ url, tenantId: 'synthetic', compression, useWorkers: false, timeout: 100, maxRetries: 0, retryDelay: 2 });
const base = (url, compression, extra = {}) => new (compression === 'snappy' ? LokiProtobufTransport : LokiJsonTransport)({ ...config(url, compression), ...extra });
async function receiver(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > 262144) req.destroy(); else chunks.push(chunk); });
    req.on('end', () => { requests.push({ at: performance.now(), wall: Date.now(), body: Buffer.concat(chunks) }); handler(req, res, requests.length); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { requests, url: `http://127.0.0.1:${server.address().port}/push`, close: async () => {
    await api.destroy().catch(() => {});
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  } };
}
const options = (url, compression, extra = {}) => ({ appName: 'legacy-retry', transport: { ...config(url, compression), ...extra }, buffer: { autoFlush: false }, circuitBreaker: { enabled: false }, interceptConsole: false });

test('Retry-After separate fields preserve max valid floor amid invalid; dates are not comma-split', () => {
  const now = Date.UTC(2026, 9, 30, 3, 0, 0), date = new Date(now + 60000).toUTCString();
  assert.deepEqual(parseRetryAfter(['nonsense', '30', '60'], now), { delay: 60000, invalid: true, huge: false });
  assert.deepEqual(parseRetryAfter(date, now), { delay: 60000, invalid: false, huge: false });
  for (const date of ['Friday, 30-Oct-26 03:01:00 GMT', 'Fri Oct 30 03:01:00 2026']) assert.equal(parseRetryAfter(date, now).delay, 60000);
  for (const value of ['60, 120', '-1', '1.5', '', '\u00a060', 'Fri, 30 Feb 2026 03:01:00 GMT', 'x'.repeat(1025)]) assert.deepEqual(parseRetryAfter(value, now), { delay: 0, invalid: true, huge: false });
  assert.deepEqual(parseRetryAfter(['60', 'x'.repeat(1025)], now), { delay: 60000, invalid: true, huge: false });
  assert.equal(parseRetryAfter('9'.repeat(100), now).huge, true);
  assert.equal(parseRetryAfter('x'.repeat(5000), now).huge, false);
});

test('owned monotonic gate declines insufficient budget without clamping; finite expiry/cancel and huge degradation are explicit', async () => {
  const gate = new RetryGate(), short = sendScope(50);
  try {
    gate.observe(new RetryAfterError(429, performance.now() + 60000, false, false));
    for (let n = 0; n < 2; n++) await assert.rejects(gate.wait(short.deadline, short.signal), { message: RETRY_CODES.deadline });
  } finally { short.close(); gate.close(); }
  const expiring = new RetryGate(), scope = sendScope(500);
  try {
    const start = performance.now(); expiring.observe(new RetryAfterError(503, start + 40, false, false));
    await expiring.wait(scope.deadline, scope.signal); assert.ok(performance.now() - start >= 40);
    await expiring.wait(scope.deadline, scope.signal);
    expiring.observe(new RetryAfterError(429, 0, false, true));
    await assert.rejects(expiring.wait(scope.deadline, scope.signal), { message: RETRY_CODES.huge });
    assert.deepEqual(expiring.diagnostics(), [RETRY_CODES.huge]);
  } finally { scope.close(); expiring.close(); }
});

test('real public JSON/protobuf 429/503 long floors survive maxRetries0 and later sends without a sixty-second wait', async () => {
  for (const compression of ['none', 'snappy']) for (const status of [429, 503]) {
    const target = await receiver((_req, res) => { res.writeHead(status, { 'Retry-After': ['invalid', '60'] }); res.end(); });
    try {
      const logger = api.init(options(target.url, compression)); const start = performance.now();
      logger.info('first-producer'); await assert.rejects(logger.flush());
      logger.info('next-producer'); await assert.rejects(logger.flush(), { message: RETRY_CODES.deadline });
      assert.equal(target.requests.length, 1); assert.ok(performance.now() - start < 1000);
      assert.ok(logger.getHealth().rateLimitCodes.includes(RETRY_CODES.invalid));
      assert.equal(logger.getMetrics().logsDropped, 0); assert.equal(logger.getMetrics().errorCount, 2);
    } finally { await target.close(); }
  }
});

test('real public delta/date floors retry identical JSON/protobuf only after server minimum and then recover', async () => {
  for (const compression of ['none', 'snappy']) for (const kind of ['delta', 'date']) {
    let floorWall;
    const target = await receiver((_req, res, count) => {
      if (count === 1) {
        const now = Math.floor(Date.now() / 1000) * 1000;
        floorWall = kind === 'date' ? now + 2000 : Date.now() + 1000;
        res.writeHead(503, { Date: new Date(now).toUTCString(), 'Retry-After': kind === 'delta' ? '1' : new Date(floorWall).toUTCString() });
      } else res.writeHead(204);
      res.end();
    });
    try {
      const logger = api.init(options(target.url, compression, { timeout: 2500, maxRetries: 1, retryDelay: 0 }));
      logger.info('single-producer'); await logger.flush();
      assert.equal(target.requests.length, 2); assert.deepEqual(target.requests[0].body, target.requests[1].body);
      assert.ok(target.requests[1].at - target.requests[0].at >= 1000);
      assert.ok(target.requests[1].wall >= floorWall);
      assert.equal(logger.getMetrics().errorCount, 0); assert.equal(logger.getHealth().healthy, true);
    } finally { await target.close(); }
  }
});

test('direct codecs and resilient wrappers share owned cooldown across concurrent sends but not other transports', async () => {
  for (const compression of ['none', 'snappy']) for (const decorated of [false, true]) {
    const target = await receiver((_req, res, count) => { res.writeHead(count === 1 ? 429 : 204, count === 1 ? { 'Retry-After': '60' } : {}); res.end(); });
    const original = base(target.url, compression), other = base(target.url, compression);
    const transport = decorated ? new ResilientTransport(original, { maxRetries: 0, retryDelay: 0, timeout: 100 }) : original;
    try {
      await assert.rejects(transport.send([entry('first')]));
      const outcomes = await Promise.allSettled([transport.send([entry('second')]), transport.send([entry('third')])]);
      assert.ok(outcomes.every(v => v.status === 'rejected')); assert.equal(target.requests.length, 1);
      await other.send([entry('independent')]); assert.equal(target.requests.length, 2);
    } finally { await transport.destroy(); await other.destroy(); await target.close(); }
  }
});

test('invalid ambiguous oversized headers recover with finite local backoff; only valid huge floor needs reinit', async () => {
  for (const compression of ['none', 'snappy']) for (const value of ['invalid', '60, 120', 'x'.repeat(1025), '9'.repeat(100)]) {
    const target = await receiver((_req, res, count) => { res.writeHead(count === 1 ? 429 : 204, count === 1 ? { 'Retry-After': value } : {}); res.end(); });
    try {
      let logger = api.init(options(target.url, compression)); logger.info('first'); await assert.rejects(logger.flush());
      await sleep(20);
      if (value[0] === '9') {
        logger.info('blocked'); await assert.rejects(logger.flush(), { message: RETRY_CODES.huge }); assert.equal(target.requests.length, 1);
        assert.ok(logger.getHealth().rateLimitCodes.includes(RETRY_CODES.huge));
        await api.destroy(); logger = api.init(options(target.url, compression));
      } else assert.ok(logger.getHealth().rateLimitCodes.includes(RETRY_CODES.invalid));
      logger.info('recovery'); await logger.flush(); assert.equal(target.requests.length, 2); assert.equal(logger.getHealth().healthy, true);
    } finally { await target.close(); }
  }
});

test('per-operation deadline and cancellation abort actual I/O without destroying the reusable codec/pool', async () => {
  for (const compression of ['none', 'snappy']) for (const cancel of [false, true]) {
    let closed = 0; const intervals = new Set();
    const target = await receiver((_req, res, count) => {
      if (count === 1) {
        res.writeHead(200); res.write('ordinary'); const timer = setInterval(() => res.write('.'), 10); intervals.add(timer);
        res.on('close', () => { clearInterval(timer); intervals.delete(timer); closed++; });
      } else { res.writeHead(204); res.end(); }
    });
    const transport = new ResilientTransport(base(target.url, compression), { maxRetries: 0, retryDelay: 0, timeout: 100 });
    const controller = new AbortController(); let timer;
    try {
      if (cancel) timer = setTimeout(() => controller.abort(), 30);
      await assert.rejects(transport.send([entry('cancelled')], controller.signal));
      for (let n = 0; n < 50 && closed === 0; n++) await sleep(5);
      assert.equal(closed, 1); await transport.send([entry('still-functional')]); assert.equal(target.requests.length, 2);
    } finally { clearTimeout(timer); for (const interval of intervals) clearInterval(interval); await transport.destroy(); await target.close(); }
  }
});

test('Worker per-task abort removes queued/running work without cancelling unrelated tasks or oversubscribing owned workers', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-retry-worker-'));
  const script = path.join(directory, 'worker.cjs');
  fs.writeFileSync(script, "require('node:worker_threads').parentPort.on('message',t=>{if(t.data.hold||Array.isArray(t.data))return;setTimeout(()=>require('node:worker_threads').parentPort.postMessage({id:t.id,result:t.data.value}),t.data.delay||0)});");
  const pool = new WorkerPool({ maxWorkers: 2, maxQueueSize: 4, taskTimeout: 1000, workerScript: script });
  const active = new AbortController(), queued = new AbortController();
  const monitor = setInterval(() => assert.ok(pool.workers.size + pool.terminating.size <= 2), 1);
  try {
    const first = pool.execute('process', { hold: true }, undefined, active.signal).then(() => 'unexpected', error => error.message);
    const second = pool.execute('process', { value: 'other', delay: 100 });
    const third = pool.execute('process', { value: 'never' }, undefined, queued.signal).then(() => 'unexpected', error => error.message);
    const fourth = pool.execute('process', { value: 'follow-up' });
    queued.abort(); active.abort();
    assert.match(await first, /cancelled/); assert.match(await third, /cancelled/);
    assert.equal(await second, 'other'); assert.equal(await fourth, 'follow-up');
    assert.equal(pool.getMetrics().failedTasks, 2); assert.equal(pool.getMetrics().completedTasks, 2);
    // Controlled owned worker stalls the real JSON format path; abort must not fall back to HTTP.
    for (const cancel of [true, false]) {
      const target = await receiver((_req, res) => { res.writeHead(204); res.end(); });
      const transport = base(target.url, 'none', { timeout: 50 }); transport.workerPool = pool;
      const controller = new AbortController(); let timer;
      try {
        if (cancel) timer = setTimeout(() => controller.abort(), 10);
        await assert.rejects(transport.send(Array.from({ length: 51 }, () => entry('worker-bound')), controller.signal));
        assert.equal(target.requests.length, 0);
        assert.equal(await pool.execute('process', { value: 'pool-remains-functional' }), 'pool-remains-functional');
      } finally { clearTimeout(timer); transport.workerPool = undefined; await transport.destroy(); await target.close(); }
    }
  } finally { clearInterval(monitor); await pool.destroy(); fs.rmSync(directory, { recursive: true }); }
});
