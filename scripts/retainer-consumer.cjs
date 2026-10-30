'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const v8 = require('node:v8');
const { spawnSync } = require('node:child_process');

function fixture(mode, index, ids = false) {
  const bytes = crypto.randomBytes(mode === 'independent' ? 128 : 1_048_576);
  const alphabet = 'abdegijklmoprtuvwyz';
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 5 === 4 ? 32 : alphabet.charCodeAt(bytes[i] % alphabet.length);
  bytes.write('QRET_OWNER_' + index + '_', ids ? 32 : 0, 'ascii');
  if (ids) bytes.fill(97 + index, 0, 32);
  const original = bytes.toString('latin1');
  return mode === 'oversize' ? original : original.slice(0, 128);
}
const fingerprint = value => crypto.createHash('sha256').update(value, 'utf16le').digest('hex');

async function child(consumer, output, mode, site, policy = 'default') {
  assert.equal(typeof global.gc, 'function');
  const api = require(path.join(consumer, 'node_modules/elven-logs-interceptor'));
  let requests = 0, bytes = 0;
  const server = http.createServer((request, response) => {
    request.on('data', chunk => { bytes += chunk.length; if (bytes > 1_048_576) request.destroy(); });
    request.on('end', () => { requests++; response.writeHead(200, { 'content-type': 'application/x-protobuf' }); response.end(); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const keepAlive = setInterval(() => {}, 1000);
  const key = mode + '-' + site + (policy === 'default' ? '' : '-' + policy);
  let logger, current, result;
  const collect = async () => { for (let i = 0; i < 3; i++) { global.gc(); await new Promise(resolve => setImmediate(resolve)); } };
  function setup() {
    const labels = site === 'static-labels' ? Object.fromEntries(Array.from({ length: 4 }, (_, i) => ['label_' + i, fixture(mode, i)])) : {};
    const hashes = Object.values(labels).map(fingerprint);
    logger = api.init({ appName: 'retainer-control', labels,
      transport: { type: 'otlp', url: 'http://127.0.0.1:' + server.address().port, compression: 'none', timeout: 1000, maxRetries: 0 },
      buffer: { autoFlush: false, maxSize: 32, maxMemoryMB: 1, maxAge: 60000 },
      enableMetrics: false, silentErrors: true,
      filter: policy === 'generic' ? { sensitivePatterns: [/password/i, /token/i, /secret/i, /api[_-]?key/i, /authorization/i, /credit[_-]?card/i, /ssn/i, /cpf/i, /NEVER_MATCH_OWNER_1780/] } : { sanitize: policy !== 'disabled' },
      dynamicLabels: site === 'dynamic-labels' ? { ordinary: () => current || '' } : site === 'ids' ? { trace_id: () => current?.slice(0, 32) || '', span_id: () => current?.slice(0, 16) || '', request_id: () => current || '' } : {},
    });
    assert.deepEqual(Object.values(labels).map(fingerprint), hashes);
  }
  function produce() {
    for (let i = 0; i < 4; i++) {
      const value = fixture(mode, i, site === 'ids'), before = fingerprint(value);
      if (site === 'message') logger.info(value, { payload: value });
      else if (site === 'context-values') logger.info('ordinary event', { field: value, array: [value] });
      else if (site === 'context-keys') logger.info('ordinary event', { [value]: 'ordinary value' });
      else if (site === 'async-context') logger.withContext({ field: value }, () => logger.info('ordinary event'));
      else { current = value; logger.info('ordinary event'); current = undefined; }
      assert.equal(fingerprint(value), before);
    }
  }
  try {
    setup(); await collect(); const before = process.memoryUsage();
    produce();
    // Deliberately do not clear RegExp's last-subject root: matching must own its input too.
    await collect(); const after = process.memoryUsage();
    const metrics = logger.getMetrics();
    assert.equal(metrics.logsProcessed, 4); assert.equal(metrics.bufferSize, 4); assert.equal(metrics.logsDropped, 0);
    const heap = path.join(output, key + '.heapsnapshot');
    fs.closeSync(fs.openSync(heap, 'wx', 0o600)); v8.writeHeapSnapshot(heap);
    assert.ok(fs.statSync(heap).size <= 64 * 1024 * 1024);
    result = { mode, site, policy, node: process.version, queued: metrics.bufferSize, drops: metrics.logsDropped, before, after, heap, callerUnchanged: true };
  } finally {
    try { if (logger) await api.destroy(); }
    finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); clearInterval(keepAlive); }
  }
  assert.ok(requests > 0); result.collectorRequests = requests; result.shutdownCompleted = true;
  fs.writeFileSync(path.join(output, key + '.json'), JSON.stringify(result), { flag: 'wx', mode: 0o600 });
}

function analyze(file) {
  const heap = JSON.parse(fs.readFileSync(file, 'utf8'));
  const fields = heap.snapshot.meta.node_fields, width = fields.length, kinds = heap.snapshot.meta.node_types[fields.indexOf('type')];
  const parents = [];
  for (let offset = 0; offset < heap.nodes.length; offset += width) {
    const name = heap.strings[heap.nodes[offset + fields.indexOf('name')]], bytes = heap.nodes[offset + fields.indexOf('self_size')], kind = kinds[heap.nodes[offset + fields.indexOf('type')]];
    if (kind === 'string' && name.includes('QRET_OWNER_') && (bytes >= 524288 || (bytes === 32 && name.length >= 1024))) parents.push({ offset, selfBytes: bytes, previewUnits: name.length });
  }
  return { largeSyntheticParents: parents.length, parents, note: 'External string headers are not backing size; synthetic one-MiB origin plus external delta corroborate these scoped markers. No universal RSS claim.' };
}

function parent(consumer) {
  const retained = process.env.ELVEN_RETENTION_OUTPUT;
  const output = retained ? fs.mkdtempSync(path.join(retained, 'run-')) : fs.mkdtempSync(path.join(os.tmpdir(), 'elven-retainer-'));
  const cases = [['independent', 'message', 'default'], ['oversize', 'message', 'default'], ...['message', 'context-values', 'context-keys', 'static-labels', 'dynamic-labels', 'ids', 'async-context'].map(site => ['borrowed', site, 'default']), ['borrowed', 'message', 'generic'], ['borrowed', 'message', 'disabled']];
  const results = [];
  try {
    for (const [mode, site, policy] of cases) {
      const key = mode + '-' + site + (policy === 'default' ? '' : '-' + policy);
      const home = path.join(output, key + '-home'); fs.mkdirSync(home, { mode: 0o700 });
      const env = { HOME: home, TMPDIR: home, PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', LANG: 'C', TZ: 'UTC' };
      const run = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=128', __filename, '--child', consumer, output, mode, site, policy], { env, cwd: home, encoding: 'utf8', timeout: 25000, maxBuffer: 32768 });
      if (run.status !== 0) throw new Error('Retainer child failed: ' + mode + '/' + site + ' ' + run.status + ' ' + run.stderr);
      const receipt = JSON.parse(fs.readFileSync(path.join(output, key + '.json'))), graph = analyze(receipt.heap);
      results.push({ ...receipt, externalDelta: receipt.after.external - receipt.before.external, ...graph });
      fs.writeFileSync(path.join(output, key + '-analysis.json'), JSON.stringify(results.at(-1), null, 2), { flag: 'wx', mode: 0o600 });
      if (graph.largeSyntheticParents) throw new Error('Retained one-MiB synthetic parent: ' + mode + '/' + site);
    }
    const result = { status: 'PASS', node: process.version, cases: results.length, results, scope: 'Actual packed API/owned queue+native root, four one-MiB fixtures per borrowed case. No raw original references kept; no native last-subject clearing. Not a customer RCA or whole-app performance claim.' };
    fs.writeFileSync(path.join(output, 'controller.json'), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(result));
  } finally { if (!retained) fs.rmSync(output, { recursive: true, force: true }); }
}
if (process.argv[2] === '--child') child(...process.argv.slice(3)).catch(error => { console.error(error); process.exitCode = 1; });
else { try { parent(path.resolve(process.argv[2])); } catch (error) { console.error(error); process.exitCode = 1; } }
