const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { gunzipSync, brotliDecompressSync } = require('node:zlib');
const consumer = path.resolve(process.argv[2] || '.');
const fromConsumer = createRequire(path.join(consumer, 'package.json'));
const pkg = fromConsumer('./package.json');
assert.equal(pkg.name, 'elven-logs-interceptor'); assert.equal(pkg.version, '2.0.1');
const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => warnings.push(args.map(String).join(' '));
const api = fromConsumer('./dist/index.js');
const protobuf = fromConsumer('protobufjs');
const snappy = fromConsumer('snappy');
const { LOKI_PROTO } = fromConsumer('./dist/infrastructure/transport/proto/loki-proto.js');
const Push = protobuf.parse(LOKI_PROTO).root.lookupType('logproto.PushRequest');
const rows = [];
const privateValues = ['SYNTHETIC_STATIC_3398', 'SYNTHETIC_CONTEXT_3398'];
const watchdog = setTimeout(() => { console.error('RETRY_CONSUMER_DEADLINE'); process.exit(124); }, 90000);

async function run(compression, workers, scenario, firstStatus = 429, header = '1') {
  const requests = [];
  let retryEpoch;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      requests.push({ at: performance.now(), epoch: Date.now(), body, encoding: req.headers['content-encoding'] });
      if (requests.length === 1) {
        const value = header === 'date' ? new Date(Date.now() + 1700).toUTCString() : header;
        if (header === 'date') retryEpoch = Date.parse(value);
        res.writeHead(firstStatus, { 'Retry-After': value }); res.end();
      } else { res.writeHead(200); res.end(); }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let metrics;
  try {
    const logger = api.init({ appName: 'retry-consumer', silentErrors: true,
      labels: { password: privateValues[0], email: 'synthetic@example.test' },
      transport: { type: 'loki', tenantId: 'retry-audit', url: `http://127.0.0.1:${server.address().port}/loki/api/v1/push`, compression,
        compressionThreshold: 1, useWorkers: workers, maxWorkers: 1, timeout: 300,
        maxRetries: scenario === 'decline' || scenario === 'recovery' ? 0 : 1, retryDelay: 10,
        sendTimeoutMillis: scenario === 'decline' ? 350 : 3000 },
      buffer: { autoFlush: false, maxSize: 100 }, circuitBreaker: { enabled: scenario !== 'recovery', failureThreshold: 1, resetTimeout: 10000 },
      performance: { shutdownTimeoutMillis: 500 } });
    for (let i = 0; i < 60; i++) logger.info('ordinary astral \ud83d\ude00 ' + i,
      { password: privateValues[1], payload: 'x'.repeat(240) });
    if (scenario === 'decline') {
      await assert.rejects(logger.flush(), /ELVEN_RETRY_AFTER_DECLINED/);
      logger.info('new call must not bypass the existing floor');
      await assert.rejects(logger.flush(), /ELVEN_RETRY_AFTER_DECLINED/);
      assert.equal(requests.length, 1);
      metrics = logger.getMetrics(); assert.equal(metrics.failedSendEntries, 61);
      assert.equal(metrics.unretainedSendEntries, 61); assert.equal(metrics.dlqEnqueuedEntries, 0);
      assert.equal(metrics.backpressureDeclines, 2);
    } else if (scenario === 'recovery') {
      await assert.rejects(logger.flush(), /Loki responded with 429/);
      logger.info('ordinary astral recovered'); await logger.flush(); assert.equal(requests.length, 2);
      metrics = logger.getMetrics(); assert.equal(metrics.failedSendEntries, 60); assert.equal(metrics.unretainedSendEntries, 60);
    } else {
      await logger.flush(); assert.equal(requests.length, 2);
      if (header === '1') assert.ok(requests[1].at - requests[0].at >= 1000);
      if (header === 'date') assert.ok(requests[1].epoch >= retryEpoch);
      if (Array.isArray(header)) assert.ok(requests[1].at - requests[0].at >= 1000);
      assert.equal(createHash('sha256').update(requests[0].body).digest('hex'), createHash('sha256').update(requests[1].body).digest('hex'));
      metrics = logger.getMetrics(); assert.equal(metrics.logsDropped, 0);
    }
    for (const [index, request] of requests.entries()) {
      let decoded;
      if (compression === 'snappy') decoded = Push.toObject(Push.decode(await snappy.uncompress(request.body)), { longs: String });
      else {
        const body = request.encoding === 'gzip' ? gunzipSync(request.body) : request.encoding === 'br' ? brotliDecompressSync(request.body) : request.body;
        decoded = JSON.parse(body.toString());
      }
      const text = JSON.stringify(decoded);
      for (const value of [...privateValues, 'synthetic@example.test']) assert.equal(text.includes(value), false);
      assert.ok(text.includes('ordinary astral'));
      const count = decoded.streams.reduce((sum, stream) => sum + (stream.values || stream.entries).length, 0);
      assert.equal(count, scenario === 'recovery' && index > 0 ? 1 : 60);
    }
    rows.push({ compression, workers, scenario, firstStatus, headerKind: Array.isArray(header) ? 'mixed-separate-fields' : header === '1' ? 'delta1' : header === '60' ? 'delta60' : header === 'date' ? 'date' : header.startsWith('9') ? 'huge-valid-delta' : 'malformed',
      requests: requests.length, retryGapMillis: requests.length > 1 ? requests[1].at - requests[0].at : null,
      firstEpochMillis: requests[0].epoch, secondEpochMillis: requests[1]?.epoch ?? null, retryDateEpochMillis: retryEpoch ?? null,
      firstBytes: requests[0].body.length, firstSha256: createHash('sha256').update(requests[0].body).digest('hex'),
      processed: metrics.logsProcessed, admissionDropped: metrics.logsDropped,
      failedSendEntries: metrics.failedSendEntries, unretainedSendEntries: metrics.unretainedSendEntries, status: 'PASS' });
  } finally {
    await api.destroy(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  for (const compression of ['none', 'gzip', 'brotli', 'snappy']) for (const workers of [false, true]) {
    await run(compression, workers, 'retry', workers ? 503 : 429);
    await run(compression, workers, 'decline', workers ? 503 : 429, '60');
  }
  for (const compression of ['none', 'snappy']) {
    await run(compression, false, 'retry', 503, 'date');
    await run(compression, false, 'retry', 429, ['SYNTHETIC_BAD_HEADER_841', '1']);
    await run(compression, false, 'decline', 503, '9'.repeat(64));
    await run(compression, false, 'recovery', 429, 'SYNTHETIC_BAD_HEADER_841');
  }
  assert.equal(warnings.some(value => value.includes('SYNTHETIC_BAD_HEADER_841')), false);
  assert.equal(warnings.some(value => value.includes('ELVEN_INVALID_RETRY_AFTER')), true);
  console.log(JSON.stringify({ node: process.version, candidate: pkg.version, status: 'PASS', cases: rows.length, rows,
    limits: 'Functional loopback observations, not SLA/performance qualification. No 60-second sleeps. No old artifact replaced.' }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await api.destroy(); clearTimeout(watchdog); console.warn = originalWarn;
});
