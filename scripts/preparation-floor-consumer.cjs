'use strict';
const http = require('node:http');
const path = require('node:path');
const dc = require('node:diagnostics_channel');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const product = path.resolve(process.argv[2]);
const pkg = require(path.join(product, 'package.json'));
assert.equal(pkg.name, 'elven-logs-interceptor'); assert.equal(pkg.version, '2.0.1');
const api = require(product);
const hash = text => createHash('sha256').update(text).digest('hex');
const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_';
function varied(index) {
  let result = 'A_PREPARING_' + index + '_', block = 0;
  while (result.length < 4096) {
    const bytes = createHash('sha256').update('PREPARATION_FIXTURE_' + index + '_' + block++).digest();
    for (const byte of bytes) { if (result.length === 4096) break; result += alphabet[byte % alphabet.length]; }
  }
  return result;
}
const caller = Object.freeze(Array.from({ length: 60 }, (_, index) => Object.freeze({ message: varied(index), context: Object.freeze({ batch: 'A', sequence: index }) })));
const bCaller = Object.freeze({ message: 'B_TRIGGER_PUBLIC', context: Object.freeze({ batch: 'B' }) });
const callerHash = hash(JSON.stringify(caller)), bHash = hash(JSON.stringify(bCaller));
assert.equal(callerHash, 'c0c05d2b4dbc89f4e4e42ddb9fc956f54e045d42ec29fa45cbdb778a715b5cff');
const events = [], requests = [], ids = new WeakMap(), subscriptions = [];
let nextId = 0, origin, server, destroyResolved = false, serverClosed = false, fatal;
const watchdog = setTimeout(() => { console.error('PREPARATION_FIXTURE_25S_STOP'); process.exit(124); }, 25000);
function subscribe(name, fn) { const channel = dc.channel(name); channel.subscribe(fn); subscriptions.push([channel, fn]); }
function ours(message) { try { return origin && new URL(String(message.request?.origin)).origin === origin; } catch { return false; } }
function requestId(request) { if (!ids.has(request)) ids.set(request, ++nextId); return ids.get(request); }
subscribe('undici:request:create', message => { if (ours(message)) events.push({ kind: 'request:create', id: requestId(message.request), at: performance.now() }); });
subscribe('undici:request:headers', message => { if (ours(message)) events.push({ kind: 'response:headers', id: requestId(message.request), status: message.response?.statusCode, at: performance.now() }); });
(async () => {
  server = http.createServer((req, res) => {
    let bytes = 0; const chunks = [];
    req.on('error', () => {});
    req.on('data', chunk => { bytes += chunk.length; if (bytes > 524288) { fatal = 'WIRE_CAP'; req.destroy(); } else chunks.push(chunk); });
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks);
        assert.ok(body.length <= 1048576);
        const records = JSON.parse(body.toString()).streams.flatMap(stream => stream.values.map(value => JSON.parse(value[1])));
        assert.equal(req.headers['content-encoding'], undefined);
        assert.equal(records.length, 1); assert.equal(records[0].context?.batch, 'B');
        assert.equal(records[0].message, bCaller.message);
        assert.equal(typeof records[0].id, 'string'); assert.ok(records[0].id.length > 0 && records[0].id.length <= 128);
        requests.push({ marker: 'B', records: 1, bytes, sha256: hash(body), at: performance.now(), idValid: true, response: 429, retryAfterSeconds: 60 });
        assert.equal(requests.length, 1);
        res.writeHead(429, { 'Retry-After': '60' }); res.end();
      } catch { fatal = 'UNEXPECTED_WIRE_OR_SCHEMA'; res.writeHead(500); res.end(); }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const config = { appName: 'prepare-race-public', silentErrors: true,
    transport: { type: 'loki', url: origin + '/loki/api/v1/push', tenantId: 'synthetic', compression: 'brotli', compressionLevel: 11,
      compressionThreshold: 1024, useWorkers: false, timeout: 300, maxRetries: 0, retryDelay: 0, sendTimeoutMillis: 1000 },
    filter: { maxMessageLength: 8192 }, buffer: { autoFlush: false, maxSize: 100 }, circuitBreaker: { enabled: false },
    performance: { maxConcurrentFlushes: 2, maxPendingBatches: 2, shutdownTimeoutMillis: 500 } };
  const configHash = hash(JSON.stringify(config));
  const logger = api.init(config);
  for (const record of caller) logger.info(record.message, record.context);
  const outcome = promise => promise.then(() => ({ status: 'resolved', at: performance.now() }), error => ({ status: 'rejected', error: error.message, at: performance.now() }));
  const a = outcome(logger.flush()); logger.info(bCaller.message, bCaller.context);
  const b = outcome(logger.flush());
  const [aResult, bResult] = await Promise.all([a, b]); await delay(1500);
  const metrics = logger.getMetrics();
  assert.equal(fatal, undefined); assert.equal(requests.length, 1);
  assert.equal(events.filter(event => event.kind === 'request:create').length, 1);
  assert.equal(events.filter(event => event.kind === 'response:headers' && event.status === 429).length, 1);
  assert.equal(aResult.status, 'rejected'); assert.equal(aResult.error, 'ELVEN_RETRY_AFTER_DECLINED');
  assert.equal(bResult.status, 'rejected'); assert.equal(bResult.error, 'ELVEN_RETRY_AFTER_DECLINED');
  assert.equal(hash(JSON.stringify(caller)), callerHash); assert.equal(hash(JSON.stringify(bCaller)), bHash);
  assert.equal(hash(JSON.stringify(config)), configHash);
  assert.equal(metrics.logsProcessed, 61); assert.equal(metrics.logsDropped, 0);
  assert.equal(metrics.failedSendEntries, 61); assert.equal(metrics.unretainedSendEntries, 61);
  assert.equal(metrics.dlqEnqueuedEntries, 0); assert.equal(metrics.backpressureDeclines, 2);
  assert.equal(metrics.pendingFlushBatches, 0); assert.equal(metrics.inFlightFlushes, 0);
  await api.destroy(); destroyResolved = true; server.closeAllConnections();
  await new Promise(resolve => server.close(() => { serverClosed = true; resolve(); }));
  for (const [channel, fn] of subscriptions) channel.unsubscribe(fn);
  console.log(JSON.stringify({ status: 'PASS', node: process.version, scope: 'Exact v3 fixture/default privacy, LokiJSON/Brotli; ONE pair, no A network admission',
    callerHash, callerUnchanged: true, bCallerUnchanged: true, configUnchanged: true, a: aResult, b: bResult, events, requests,
    counts: { processed: metrics.logsProcessed, admissionDropped: metrics.logsDropped, failedSendEntries: metrics.failedSendEntries, unretainedSendEntries: metrics.unretainedSendEntries, dlqEnqueuedEntries: metrics.dlqEnqueuedEntries, backpressureDeclines: metrics.backpressureDeclines },
    cleanup: { destroyResolved, serverClosed, subscriptionsRemoved: subscriptions.length }, noZeroLossClaim: true }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  try { await api.destroy(); } finally {
    if (server && !serverClosed) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    for (const [channel, fn] of subscriptions) channel.unsubscribe(fn);
    clearTimeout(watchdog);
  }
});
