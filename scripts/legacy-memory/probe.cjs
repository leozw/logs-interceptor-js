'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const v8 = require('node:v8');
const [name, directory, consumer] = process.argv.slice(2);
const api = require(path.join(consumer, 'node_modules/logs-interceptor'));
const markers = ['facadea0', 'facadeb1', 'facadec2', 'facaded3'];
const pause = () => new Promise(resolve => setImmediate(resolve));
const collect = async () => { for (let n = 0; n < 3; n++) { global.gc(); await pause(); } };
function input(index, kind, hex = false) {
  const bytes = crypto.randomBytes(kind === 'short' ? 128 : 1024 * 1024);
  const alphabet = hex ? 'abcdef' : 'abdegjklmopruvwxyz';
  for (let n = 0; n < bytes.length; n++) bytes[n] = !hex && n % 5 === 4 ? 32 : alphabet.charCodeAt(bytes[n] % alphabet.length);
  bytes.write(markers[index], 0, 'ascii');
  const original = bytes.toString('latin1');
  return kind === 'full' || kind === 'short' ? original : original.slice(0, 128);
}
function initialize(url, holder) {
  const config = {
    appName: 'legacy-memory-probe', environment: 'synthetic',
    transport: { url, tenantId: 'synthetic', compression: 'none', useWorkers: false, timeout: 1000, maxRetries: 0 },
    buffer: { autoFlush: false, maxSize: 32, maxMemoryMB: 1, maxAge: 60000 },
    filter: { sanitize: true, samplingRate: 1, maxMessageLength: 8192 },
    interceptConsole: false, enableMetrics: false, deadLetterQueue: { enabled: false },
  };
  if (name.startsWith('generic-')) config.filter.sensitivePatterns = [/^[x-z]{1,3}$/u];
  if (name.startsWith('disabled-')) config.filter.sanitize = false;
  if (name === 'ids-views') config.dynamicLabels = {
    trace_id: () => holder.value?.slice(0, 32) || '', span_id: () => holder.value?.slice(0, 16) || '', request_id: () => holder.value || '',
  };
  if (name === 'dynamic-views') config.dynamicLabels = { note: () => holder.value || '' };
  if (name === 'static-views') config.labels = Object.fromEntries(markers.map((_, n) => ['note' + n, input(n, 'views')]));
  if (name === 'identity-views') {
    config.appName = input(0, 'views'); config.version = input(1, 'views');
    config.environment = input(2, 'views'); config.labels = { note: input(3, 'views') };
  }
  return api.init(config);
}
function produce(logger, holder) {
  if (name === 'caller-control') { globalThis.__legacyCallerHold = markers.map((_, n) => input(n, 'views')); return; }
  for (let n = 0; n < 4; n++) {
    if (name === 'ids-views' || name === 'dynamic-views') {
      holder.value = input(n, 'views', name === 'ids-views'); logger.info('ordinary'); holder.value = null;
    } else if (name === 'static-views' || name === 'identity-views') logger.info('ordinary');
    else {
      const kind = name.endsWith('-short') ? 'short' : name.endsWith('-full') ? 'full' : 'views';
      const value = input(n, kind); logger.info(name.endsWith('context-views') ? 'ordinary' : value, { payload: value });
    }
  }
}
async function main() {
  assert.equal(typeof global.gc, 'function'); const keepAlive = setInterval(() => {}, 1000);
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = []; let bytes = 0;
    req.on('data', chunk => { bytes += chunk.length; if (bytes > 1048576) req.destroy(); else chunks.push(chunk); });
    req.on('end', () => { requests.push(Buffer.concat(chunks)); res.writeHead(204); res.end(); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let receipt;
  try {
    const holder = { value: null };
    const logger = initialize(`http://127.0.0.1:${server.address().port}/push`, holder);
    await collect(); const before = process.memoryUsage(); produce(logger, holder);
    await collect(); const after = process.memoryUsage();
    const metrics = logger.getMetrics(); const expected = name === 'caller-control' ? 0 : 4;
    assert.equal(metrics.logsProcessed, expected); assert.equal(metrics.bufferSize, expected); assert.equal(metrics.logsDropped, 0);
    assert.deepEqual(logger.getHealth().privacyCodes, []);
    const file = path.join(directory, name + '.heapsnapshot'); fs.closeSync(fs.openSync(file, 'wx', 0o600));
    v8.writeHeapSnapshot(file); const size = fs.statSync(file).size; assert.ok(size < 64 * 1024 * 1024);
    receipt = { name, node: process.version, before, after, externalDelta: after.external - before.external, expectedRecords: expected, processed: metrics.logsProcessed, queued: metrics.bufferSize, drops: metrics.logsDropped, snapshot: file, snapshotBytes: size, noForcedRegExpRootClearing: true, producerReferences: name === 'caller-control' ? 'Intentional global positive control, not library blame' : 'Local producer returned; dynamic holder nulled; no payload array retained' };
  } finally {
    try { await api.destroy(); }
    finally { delete globalThis.__legacyCallerHold; server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); clearInterval(keepAlive); }
  }
  const rows = requests.flatMap(buffer => JSON.parse(buffer.toString()).streams.flatMap(stream => stream.values.map(([, line]) => ({ stream: stream.stream, entry: JSON.parse(line) }))));
  assert.equal(rows.length, receipt.expectedRecords);
  for (let n = 0; n < rows.length; n++) {
    const { entry, stream } = rows[n];
    if (name === 'ids-views') { assert.equal(entry.traceId.length, 32); assert.equal(entry.spanId.length, 16); assert.equal(entry.requestId.length, 128); assert.ok(entry.requestId.startsWith(markers[n])); }
    else if (name === 'dynamic-views') { assert.equal(stream.note.length, 128); assert.ok(stream.note.startsWith(markers[n])); }
    else if (name === 'static-views') for (let j = 0; j < 4; j++) { assert.equal(stream['note' + j].length, 128); assert.ok(stream['note' + j].startsWith(markers[j])); }
    else if (name === 'identity-views') { for (const [key, j] of [['app', 0], ['version', 1], ['environment', 2], ['note', 3]]) { assert.equal(stream[key].length, 128); assert.ok(stream[key].startsWith(markers[j])); } }
    else if (name.endsWith('context-views')) { assert.equal(entry.message, 'ordinary'); assert.equal(entry.context.payload.length, 128); assert.ok(entry.context.payload.startsWith(markers[n])); }
    else { assert.ok(entry.message.startsWith(markers[n])); assert.ok(entry.context.payload.startsWith(markers[n])); assert.ok(entry.message.length <= 8206); assert.ok(entry.context.payload.length <= 8206); if (!name.endsWith('-full')) { assert.equal(entry.message.length, 128); assert.equal(entry.context.payload.length, 128); } }
  }
  receipt.shutdownCompleted = true; receipt.collectorRequests = requests.length; receipt.decodedWireRecords = rows.length;
  fs.writeFileSync(path.join(directory, name + '.json'), JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ name, queued: receipt.queued, drops: receipt.drops, externalDelta: receipt.externalDelta, snapshotBytes: receipt.snapshotBytes, decodedWireRecords: rows.length }));
}
main().catch(error => { fs.writeFileSync(path.join(directory, name + '.failure.json'), JSON.stringify({ name, error: error.stack }), { mode: 0o600 }); console.error('LEGACY_MEMORY_PROBE_FAILED'); process.exitCode = 1; });
