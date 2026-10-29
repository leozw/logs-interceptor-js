const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { Worker } = require('node:worker_threads');
const { WorkerPool } = require('../dist/infrastructure/workers/WorkerPool');
const api = require('../dist');
const tick = () => new Promise(resolve => setImmediate(resolve));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const end = Date.now() + 3000;
  while (!predicate()) {
    assert.ok(Date.now() < end, 'Controlled receiver deadline');
    await sleep(5);
  }
}
async function receiver(onRequest) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      let bytes = Buffer.concat(chunks);
      if (req.headers['content-encoding'] === 'gzip') bytes = zlib.gunzipSync(bytes);
      requests.push(JSON.parse(bytes.toString()));
      onRequest(res, requests.length);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { requests, url: `http://127.0.0.1:${server.address().port}/push`, close: async () => {
    await api.destroy().catch(() => {});
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  } };
}
const config = url => ({ appName: 'legacy-review', transport: { url, tenantId: 'synthetic', compression: 'none', useWorkers: false, maxRetries: 0, timeout: 1000 }, buffer: { autoFlush: false }, interceptConsole: false });

test('LR01 native Winston1000/end retains all completion and logged events with bounded pending notifications', async () => {
  // Exact root/default/logger keys observed from the integrity-verified public2.1.6 archive.
  assert.deepEqual(Object.keys(api).sort(), ['LogLevelVO', 'MorganAdapter', 'WinstonTransport', 'default', 'destroy', 'getLogger', 'init', 'isInitialized', 'logger']);
  assert.deepEqual(Object.keys(api.default).sort(), ['destroy', 'getLogger', 'init', 'isInitialized', 'logger']);
  assert.deepEqual(Object.keys(api.logger).sort(), ['debug', 'destroy', 'error', 'fatal', 'flush', 'getHealth', 'getMetrics', 'info', 'log', 'trackEvent', 'warn']);
  const namespace = await import(require('node:url').pathToFileURL(require.resolve('../dist')).href);
  for (const key of ['init', 'getLogger', 'isInitialized', 'destroy', 'logger', 'WinstonTransport', 'MorganAdapter', 'LogLevelVO']) assert.equal(namespace[key], api[key]);
  const winston = require('winston');
  let processed = 0;
  let logged = 0;
  const errors = [];
  const transport = new api.WinstonTransport({ logger: { info: () => processed++ } });
  transport.on('logged', () => logged++);
  transport.on('error', error => errors.push(error));
  const logger = winston.createLogger({ transports: [transport] });
  logger.on('error', error => errors.push(error));
  try {
    for (let i = 0; i < 1000; i++) {
      logger.info('controlled-pressure-' + i);
      assert.ok(transport.pendingLogged.length <= 128);
    }
    await new Promise((resolve, reject) => { logger.once('finish', resolve); logger.once('error', reject); logger.end(); });
    await tick();
    assert.equal(processed, 1000);
    assert.equal(logged, 1000);
    assert.deepEqual(errors, []);
    assert.equal(transport.pendingLogged.length, 0);
  } finally { logger.close(); transport.destroy(); }
});

test('LR02 quiet tail re-arms after coalesced success or failure without overlapping sends or retry loops', async () => {
  for (const firstStatus of [204, 500]) for (const maxSize of [1, 100]) {
    let active = 0;
    let maximumActive = 0;
    const target = await receiver((res, count) => {
      maximumActive = Math.max(maximumActive, ++active);
      res.on('finish', () => active--);
      if (count === 1) setTimeout(() => { res.writeHead(firstStatus); res.end(); }, 150);
      else { res.writeHead(204); res.end(); }
    });
    try {
      const logger = api.init({ ...config(target.url), buffer: { autoFlush: true, maxSize, flushInterval: 20 } });
      logger.info('first');
      await until(() => target.requests.length === 1);
      logger.info('quiet-tail');
      const pending = Array.from({ length: 20 }, () => logger.flush().catch(() => {}));
      await Promise.all(pending);
      await until(() => target.requests.length === 2 && logger.getMetrics().bufferSize === 0);
      await sleep(100);
      assert.equal(target.requests.length, 2);
      assert.equal(maximumActive, 1);
      assert.equal(logger.getMetrics().errorCount, firstStatus === 500 ? 1 : 0);
      assert.ok(JSON.stringify(target.requests[1]).includes('quiet-tail'));
    } finally { await target.close(); }
  }
});

test('LR03 default Loki correlation selectors survive and low-cardinality is an explicit opt-in', async () => {
  const target = await receiver(res => { res.writeHead(204); res.end(); });
  const correlation = { trace_id: '12345678901234567890123456789012', span_id: '1234567890123456', request_id: 'synthetic-request-id' };
  try {
    for (const mode of ['default', 'indexed', 'low-cardinality']) {
      const options = { ...config(target.url), dynamicLabels: Object.fromEntries(Object.entries({ ...correlation, lane: 'retained', api_key: 'synthetic-private-key' }).map(([key, value]) => [key, () => value])) };
      if (mode !== 'default') options.indexCorrelationIds = mode === 'indexed';
      const logger = api.init(options);
      logger.info('selectors', { password: 'synthetic-password' });
      await logger.flush();
      await api.destroy();
      const payload = target.requests.at(-1);
      const stream = payload.streams[0];
      for (const [key, value] of Object.entries(correlation)) assert.equal(stream.stream[key], mode === 'low-cardinality' ? undefined : value);
      assert.equal(stream.stream.lane, 'retained');
      assert.equal(stream.stream.api_key, '[REDACTED]');
      const line = JSON.parse(stream.values[0][1]);
      assert.equal(line.traceId, correlation.trace_id);
      assert.equal(line.spanId, correlation.span_id);
      assert.equal(line.requestId, correlation.request_id);
      assert.equal(JSON.stringify(payload).includes('synthetic-password'), false);
      assert.equal(JSON.stringify(payload).includes('synthetic-private-key'), false);
    }
    const logger = api.init({ ...config(target.url), dynamicLabels: { request_id: () => 'Bearer synthetic-correlation-secret' } });
    logger.info('private-correlation');
    await logger.flush(); await api.destroy();
    assert.equal(JSON.stringify(target.requests.at(-1)).includes('synthetic-correlation-secret'), false);
    const custom = api.init({ ...config(target.url), dynamicLabels: { span_id: () => correlation.span_id }, filter: { sensitivePatterns: [/span/i] } });
    custom.info('explicit-policy');
    await custom.flush(); await api.destroy();
    assert.equal(target.requests.at(-1).streams[0].stream.span_id, '[REDACTED]');
    assert.equal(JSON.parse(target.requests.at(-1).streams[0].values[0][1]).spanId, '[REDACTED]');
    const staticallyConfigured = api.init({ ...config(target.url), indexCorrelationIds: false, labels: { request_id: 'explicit-static-id' }, dynamicLabels: { request_id: () => correlation.request_id } });
    staticallyConfigured.info('static-label-opt-in');
    await staticallyConfigured.flush(); await api.destroy();
    assert.equal(target.requests.at(-1).streams[0].stream.request_id, 'explicit-static-id');
    assert.equal(JSON.parse(target.requests.at(-1).streams[0].values[0][1]).requestId, correlation.request_id);
  } finally { await target.close(); }
});

test('LR04 only SDK-owned Workers suppress automatic root/preload initialization and stay bounded', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-owned-worker-'));
  const script = path.join(directory, 'owned.cjs');
  const modulePath = require.resolve('../dist');
  const preloadPath = require.resolve('../preload.js');
  fs.writeFileSync(script, `const api=require(${JSON.stringify(modulePath)});require(${JSON.stringify(preloadPath)});require('node:worker_threads').parentPort.on('message',task=>{require('node:worker_threads').parentPort.postMessage({id:task.id,result:{active:api.isInitialized(),nodeOptions:process.env.NODE_OPTIONS,execArgv:process.execArgv,owned:process.env.LOGS_INTERCEPTOR_INTERNAL_WORKER}});});`);
  const oldUrl = process.env.LOGS_INTERCEPTOR_URL;
  const oldTenant = process.env.LOGS_INTERCEPTOR_TENANT_ID;
  const oldApp = process.env.LOGS_INTERCEPTOR_APP_NAME;
  const oldOptions = process.env.NODE_OPTIONS;
  process.env.LOGS_INTERCEPTOR_URL = 'http://127.0.0.1:9/push';
  process.env.LOGS_INTERCEPTOR_TENANT_ID = 'synthetic';
  process.env.LOGS_INTERCEPTOR_APP_NAME = 'internal-only';
  process.env.NODE_OPTIONS = `--require ${preloadPath}`;
  const pool = new WorkerPool({ maxWorkers: 2, maxQueueSize: 4, workerScript: script });
  try {
    const tasks = Array.from({ length: 100 }, () => pool.execute('process', []).then(value => ({ ok: true, value }), () => ({ ok: false })));
    assert.ok(pool.getMetrics().activeWorkers <= 2);
    assert.ok(pool.getMetrics().queueLength <= 4);
    assert.equal(pool.workers.size, 2);
    const results = await Promise.all(tasks);
    assert.equal(results.filter(item => item.ok).length, 6);
    for (const { value } of results.filter(item => item.ok)) assert.deepEqual(value, { active: false, nodeOptions: undefined, execArgv: [], owned: 'true' });
  } finally {
    await pool.destroy();
    for (const [key, value] of Object.entries({ LOGS_INTERCEPTOR_URL: oldUrl, LOGS_INTERCEPTOR_TENANT_ID: oldTenant, LOGS_INTERCEPTOR_APP_NAME: oldApp, NODE_OPTIONS: oldOptions })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true });
  }
});

test('LR04 application Worker root/preload auto-init actually exports and respects the correlation opt-in', async () => {
  const target = await receiver(res => { res.writeHead(204); res.end(); });
  const modulePath = require.resolve('../dist');
  const preloadPath = require.resolve('../preload.js');
  const otelPath = require.resolve('@opentelemetry/api');
  try {
    for (const preload of [false, true]) for (const indexed of [true, false]) {
      const before = target.requests.length;
      let worker;
      let stdout = '';
      try {
        const state = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Application Worker deadline')), 4000);
          const code = `(async()=>{
            const api=require(${JSON.stringify(modulePath)}),otel=require(${JSON.stringify(otelPath)});
            let active=otel.ROOT_CONTEXT;
            otel.context.setGlobalContextManager({active:()=>active,with(ctx,fn,thisArg,...args){const previous=active;active=ctx;try{return fn.apply(thisArg,args);}finally{active=previous;}},bind:(_ctx,target)=>target,enable(){return this;},disable(){active=otel.ROOT_CONTEXT;return this;}});
            const initialized=api.isInitialized();
            const span=otel.trace.wrapSpanContext({traceId:'12345678901234567890123456789012',spanId:'1234567890123456',traceFlags:1});
            otel.context.with(otel.trace.setSpan(otel.context.active(),span),()=>api.logger.info('application-worker-entry'));
            await api.destroy();otel.context.disable();
            require('node:worker_threads').parentPort.postMessage({initialized,owned:process.env.LOGS_INTERCEPTOR_INTERNAL_WORKER});
          })().catch(error=>require('node:worker_threads').parentPort.postMessage({error:error.message}));`;
          worker = new Worker(code, { eval: true, execArgv: preload ? ['--require', preloadPath] : [], stdout: true, stderr: true, env: { PATH: '/usr/bin:/bin', NODE_OPTIONS: '', LOGS_INTERCEPTOR_URL: target.url, LOGS_INTERCEPTOR_TENANT_ID: 'synthetic', LOGS_INTERCEPTOR_APP_NAME: 'application-worker', LOGS_INTERCEPTOR_USE_WORKERS: 'false', LOGS_INTERCEPTOR_INTERCEPT_CONSOLE: 'false', LOGS_INTERCEPTOR_MAX_RETRIES: '0', LOGS_INTERCEPTOR_INDEX_CORRELATION_IDS: String(indexed) } });
          worker.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(0, 8192); });
          worker.stderr.resume();
          worker.once('message', message => { clearTimeout(timer); resolve(message); });
          worker.once('error', error => { clearTimeout(timer); reject(error); });
        });
        assert.equal(state.error, undefined);
        assert.equal(state.initialized, true);
        assert.equal(state.owned, undefined);
        const rows = target.requests.slice(before).flatMap(payload => payload.streams.flatMap(stream => stream.values.map(([, line]) => ({ labels: stream.stream, line: JSON.parse(line) }))));
        const entry = rows.find(row => row.line.message === 'application-worker-entry');
        assert.ok(entry);
        assert.equal(entry.line.traceId, '12345678901234567890123456789012');
        assert.equal(entry.line.spanId, '1234567890123456');
        assert.equal(entry.labels.trace_id, indexed ? entry.line.traceId : undefined);
        assert.equal(entry.labels.span_id, indexed ? entry.line.spanId : undefined);
      } finally {
        await worker?.terminate();
      }
      await tick();
      assert.equal((stdout.match(/Selected LokiJsonTransport/g) || []).length, 1, 'Preload must not create a transient default logger before its configured instance');
    }
  } finally { await target.close(); }
});

test('public logsDropped counts bounded evictions plus filtered entries without console diagnostics', async () => {
  const target = await receiver(res => { res.writeHead(204); res.end(); });
  try {
    const logger = api.init({ ...config(target.url), buffer: { autoFlush: false, maxSize: 8, maxMemoryMB: 1 }, filter: { patterns: [/keep/] } });
    logger.info('filtered');
    for (let i = 0; i < 1000; i++) logger.info('keep-' + i);
    assert.equal(logger.getMetrics().logsProcessed, 1000);
    assert.equal(logger.getMetrics().bufferSize, 8);
    assert.equal(logger.getMetrics().logsDropped, 993);
    await logger.flush();
    assert.equal(target.requests[0].streams[0].values.length, 8);
    assert.equal(logger.getMetrics().logsDropped, 993);
    await api.destroy();
    const tiny = api.init({ ...config(target.url), buffer: { autoFlush: false, maxSize: 8, maxMemoryMB: 0.001 } });
    tiny.info('x'.repeat(2000));
    assert.equal(tiny.getMetrics().bufferSize, 0);
    assert.equal(tiny.getMetrics().logsDropped, 1);
  } finally { await target.close(); }
});
