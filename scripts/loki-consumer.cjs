'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');
const { createRequire } = require('node:module');
const root = path.resolve(process.argv[2]), use = createRequire(path.join(root, 'package.json'));
const api = use('elven-logs-interceptor'), protobuf = use('protobufjs'), snappy = use('snappy');
const { LOKI_PROTO } = use('elven-logs-interceptor/dist/infrastructure/transport/proto/loki-proto.js');
const pushType = protobuf.parse(LOKI_PROTO).root.lookupType('logproto.PushRequest');
const rows = [], requests = [];
const guard = setTimeout(() => process.exit(124), 10000);
const server = http.createServer((req, res) => {
  const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => { requests.push({ body: Buffer.concat(chunks), headers: req.headers }); res.end(); });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  for (const compression of ['none', 'gzip', 'brotli', 'snappy']) for (const workers of [false, true]) {
    const before = requests.length;
    const logger = api.init({ appName: 'loki-artifact', labels: { password: 'synthetic-static-private' }, filter: { sensitivePatterns: [/password/i, /PRIVATE_\d+/, /(a|aa)+b/] },
      transport: { type: 'loki', url: `http://127.0.0.1:${server.address().port}/loki/api/v1/push`, tenantId: 'synthetic-audit-tenant', compression, compressionThreshold: 1, useWorkers: workers, maxWorkers: 1, timeout: 1000, maxRetries: 0 },
      buffer: { autoFlush: false, maxSize: 1000 } });
    for (let i = 0; i < 60; i++) logger.info('ordinary-' + 'a'.repeat(512), { password: 'synthetic-context-private', privateValue: 'PRIVATE_7312' });
    await logger.flush();
    assert.equal(requests.length - before, 1);
    const response = requests.at(-1);
    let body = response.body;
    if (compression === 'gzip') body = zlib.gunzipSync(body);
    if (compression === 'brotli') body = zlib.brotliDecompressSync(body);
    if (compression === 'snappy') body = snappy.uncompressSync(body);
    for (const value of ['synthetic-static-private', 'synthetic-context-private', 'PRIVATE_7312']) assert.equal(body.includes(Buffer.from(value)), false);
    const decoded = compression === 'snappy' ? pushType.toObject(pushType.decode(body)) : JSON.parse(body);
    const records = decoded.streams.reduce((sum, stream) => sum + (stream.values || stream.entries).length, 0);
    assert.equal(records, 60); assert.equal(response.headers['user-agent'], 'elven-logs-interceptor/2.0.0');
    const base = logger.transport.transport;
    const workerMetrics = base.workerPool?.getMetrics();
    if (workers) assert.ok(workerMetrics.completedTasks >= 1);
    rows.push({ compression, workers, records, wireBytes: response.body.length, decodedBytes: body.length, workerMetrics });
    await api.destroy();
  }
  process.stdout.write(JSON.stringify({ status: 'PASS', node: process.version, rows }) + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await api.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); clearTimeout(guard); });
