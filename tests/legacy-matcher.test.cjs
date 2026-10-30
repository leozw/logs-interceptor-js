const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { test } = require('node:test');
const api = require('../dist');
const core = require('../dist/infrastructure/privacy/matcher-core.cjs');
const { ConfigService } = require('../dist/application/services/ConfigService');
const { detectSensitiveData, sanitizeData } = require('../dist/utils');

const options = url => ({ appName: 'legacy-matcher', transport: { url, tenantId: 'synthetic', compression: 'none', useWorkers: false, maxRetries: 0, timeout: 500 }, buffer: { autoFlush: false }, interceptConsole: false, enableMetrics: false });
async function receiver() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > 262144) req.destroy(); else chunks.push(chunk); });
    req.on('end', () => { requests.push({ bytes: Buffer.concat(chunks), headers: req.headers }); res.writeHead(204); res.end(); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { requests, url: `http://127.0.0.1:${server.address().port}/push`, close: async () => {
    await api.destroy().catch(() => {});
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  } };
}
async function decode(request) {
  if (request.headers['content-encoding'] === 'snappy') {
    const bytes = await require('snappy').uncompress(request.bytes);
    const type = require('protobufjs').parse(require('../dist/infrastructure/transport/proto/loki-proto').LOKI_PROTO).root.lookupType('logproto.PushRequest');
    const payload = type.decode(bytes);
    return { text: JSON.stringify(payload), selectors: payload.streams.map(stream => stream.labels), rows: payload.streams.flatMap(stream => stream.entries.map(entry => JSON.parse(entry.line))) };
  }
  const payload = JSON.parse(request.bytes.toString());
  return { text: JSON.stringify(payload), selectors: payload.streams.map(stream => stream.stream), rows: payload.streams.flatMap(stream => stream.values.map(([, line]) => JSON.parse(line))) };
}

async function childOperation(spec) {
  const target = await receiver();
  try {
    const config = options(target.url);
    const value = (spec.forceEngine ? 'b' : '') + 'a'.repeat(64);
    const pattern = /(a|aa)+b/;
    if (spec.target !== 'defaults-lazy') config.filter = spec.target === 'selector' ? { patterns: [pattern], sanitize: false } : { sensitivePatterns: [pattern] };
    if (spec.target === 'dynamic-label') config.dynamicLabels = { note: () => value };
    if (spec.target === 'static-info' || spec.target === 'static-init') config.labels = { note: value };
    let logger = spec.target === 'static-init' ? undefined : api.init(config);
    process.send({ ready: true });
    await new Promise(resolve => process.once('message', resolve));
    const start = process.hrtime.bigint();
    if (spec.target === 'static-init') logger = api.init(config);
    else if (spec.target === 'utils') detectSensitiveData(value, [pattern]);
    else if (spec.target === 'defaults-lazy') {
      logger.info('Bearer\u00a0synthetic-default');
      logger.info('Bearer\ufeffsynthetic-default');
    } else {
      const context = spec.target === 'context-key' ? { [value]: 'ordinary' } : spec.target === 'context-value' ? { note: value } : {};
      logger.info(['message', 'selector'].includes(spec.target) ? value : 'ordinary', context);
    }
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    await logger?.flush();
    const health = logger?.getHealth();
    const backendLoaded = Object.keys(require.cache).some(file => file.includes('/node_modules/re2js/') || file.includes('/node_modules/@eslint-community/regexpp/'));
    return { elapsedMs, privacyCodes: health?.privacyCodes, backendLoaded, requests: target.requests.length };
  } finally { await target.close(); }
}

function watchdog(spec) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, '--matcher-child', JSON.stringify(spec)], { env: { PATH: '/usr/bin:/bin', HOME: require('node:os').tmpdir() }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let result; let timedOut = false; let stderr = '';
    let timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 10000);
    child.stdout.resume(); child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4096); });
    child.on('message', message => {
      if (message.ready) { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 2500); child.send({ run: true }); }
      else result = message;
    });
    child.once('error', reject);
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      try { assert.equal(timedOut, false, 'Owned operation watchdog: ' + spec.target); assert.equal(status, 0, stderr + JSON.stringify(result) + signal); resolve(result); } catch (error) { reject(error); }
    });
  });
}

if (process.argv[2] === '--matcher-child') {
  childOperation(JSON.parse(process.argv[3])).then(result => process.send({ result }, () => process.exit(0))).catch(error => process.send({ error: error.message }, () => process.exit(1)));
} else {
  test('shared core keeps frozen identity and actual custom matching never invokes caller native methods', () => {
    const origin = require('../dist/infrastructure/privacy/shared-core.json');
    const bytes = fs.readFileSync(require.resolve('../dist/infrastructure/privacy/matcher-core.cjs'));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), origin.sha256);
    assert.equal(origin.sourceCommit, '5bab9d02db635b0c1337c73e6a913e77689112a6');
    assert.equal(origin.sha256, '6cf326f3d00a2727435cfe32044443895a369aa55e290ae98c8cad97a7d72f91');
    const pattern = /(a|aa)+b/;
    pattern.test = pattern.exec = () => { throw new Error('Caller native method invoked'); };
    const policy = new core.Policy({ sensitive: [pattern] }); const call = policy.begin();
    try { assert.equal(policy.privacy('b' + 'a'.repeat(64), call), false); assert.ok(call.summary().engineCalls > 0); assert.equal(call.failed, false); }
    finally { call.close(); policy.close(); }
  });

  test('actual legacy CPU paths complete in owned watchdog children and default masks keep backend lazy', async () => {
    for (const target of ['message', 'selector', 'context-key', 'context-value', 'dynamic-label', 'static-info', 'static-init', 'utils', 'defaults-lazy']) {
      for (const forceEngine of target === 'defaults-lazy' ? [false] : [false, true]) {
        const row = await watchdog({ target, forceEngine });
        assert.ok(row.result.elapsedMs < 2500);
        assert.deepEqual(row.result.privacyCodes, []);
        if (target === 'defaults-lazy') assert.equal(row.result.backendLoaded, false);
      }
    }
  });

  test('JSON and protobuf wire retain indexed numeric IDs but mask correlation credentials and explicit overrides', async () => {
    const target = await receiver();
    const trace = '12345678901234567890123456789012', span = '1234567890123456';
    try {
      for (const compression of ['none', 'snappy']) for (const mode of ['default', 'explicit', 'invalid', 'disabled']) {
        const config = options(target.url); config.transport.compression = compression;
        const invalid = mode === 'invalid';
        config.dynamicLabels = { trace_id: () => invalid ? 'Bearer synthetic-trace-private' : trace, span_id: () => invalid ? 'Bearer synthetic-span-private' : span, request_id: () => 'Bearer synthetic-request-private', note: () => 'Bearer synthetic-note-private' };
        if (mode === 'explicit') config.filter = { sensitivePatterns: [/span/i] };
        if (mode === 'disabled') config.filter = { sanitize: false };
        const logger = api.init(config); logger.info('wire-contract'); await logger.flush(); await api.destroy();
        const wire = await decode(target.requests.at(-1)); const entry = wire.rows[0];
        assert.equal(wire.text.includes('synthetic-request-private'), mode === 'disabled');
        assert.equal(wire.text.includes('synthetic-note-private'), mode === 'disabled');
        if (invalid) {
          assert.equal(wire.text.includes('synthetic-trace-private'), false); assert.equal(wire.text.includes('synthetic-span-private'), false);
          assert.equal(entry.traceId, '[REDACTED]'); assert.equal(entry.spanId, '[REDACTED]');
        } else {
          assert.equal(entry.traceId, trace); assert.equal(entry.spanId, mode === 'explicit' ? '[REDACTED]' : span);
          assert.ok(wire.text.includes('trace_id')); assert.ok(wire.text.includes('span_id')); assert.ok(wire.text.includes('request_id'));
        }
        assert.equal(entry.requestId, mode === 'disabled' ? 'Bearer synthetic-request-private' : '[REDACTED]');
      }
    } finally { await target.close(); }
  });

  test('aggregate compiled-plan rejection preserves the previous actual logger before any retirement', async () => {
    const target = await receiver();
    try {
      const previous = api.init(options(target.url));
      const rules = Array.from({ length: 32 }, () => new RegExp('a'.repeat(100)));
      const config = { ...options(target.url), filter: { patterns: rules, sensitivePatterns: [...rules] } };
      assert.deepEqual(ConfigService.validate(config), []);
      assert.throws(() => api.init(config), /ELVEN_MATCHER_COMPILE_BUDGET/);
      assert.equal(api.isInitialized(), true); assert.equal(api.getLogger(), previous);
      assert.equal(previous.getHealth().healthy, true);
      previous.info('retained-working-runtime'); await previous.flush();
      assert.ok((await decode(target.requests[0])).text.includes('retained-working-runtime'));
      assert.deepEqual(previous.getHealth().privacyCodes, []);
      await previous.destroy(); assert.equal(api.isInitialized(), false);
      const replacement = api.init(options(target.url));
      await previous.destroy(); assert.equal(api.getLogger(), replacement);
      replacement.info('replacement-still-owned'); await replacement.flush();
      assert.ok((await decode(target.requests.at(-1))).text.includes('replacement-still-owned'));
    } finally { await target.close(); }
  });

  test('public UTF16 default and generic policies fail closed on six sites while valid wire controls survive', async () => {
    const target = await receiver(); const failures = []; const rows = [];
    try {
      for (const compression of ['none', 'snappy']) for (const generic of [false, true]) {
        for (const unit of ['\ud800', '\udc00']) for (const site of ['message', 'selector', 'context-key', 'context-value', 'dynamic-label', 'static-label']) {
          const config = options(target.url); config.transport.compression = compression;
          if (generic) config.filter = { sensitivePatterns: [...core.DEFAULTS, /unmatchable(?:custom)/u] };
          if (site === 'selector') config.filter = { ...config.filter, sanitize: false, patterns: [generic ? /password(?:)/u : /password/i] };
          const value = 'ordinary' + unit; const key = 'field' + unit;
          if (site === 'dynamic-label') config.dynamicLabels = { note: () => value };
          if (site === 'static-label') config.labels = { note: value };
          const logger = api.init(config); const before = target.requests.length;
          const context = site === 'context-key' ? { [key]: 'unpaired-key-marker' } : site === 'context-value' ? { note: value } : {};
          logger.info(site === 'selector' ? 'password' + unit : site === 'message' ? value : 'ordinary', context);
          await logger.flush(); const codes = logger.getHealth().privacyCodes;
          const row = { compression, generic, unit: unit.charCodeAt(0).toString(16), site, codes, sent: target.requests.length - before };
          try {
            assert.ok(codes.includes('ELVEN_MATCHER_UNSUPPORTED_INPUT'));
            assert.equal(logger.getHealth().healthy, false);
            assert.ok(codes.every(code => Object.values(core.CODES).includes(code)));
            if (site === 'selector') { assert.equal(row.sent, 0); assert.equal(logger.getMetrics().logsDropped, 1); }
            else {
              assert.equal(row.sent, 1); const wire = await decode(target.requests.at(-1)); const entry = wire.rows[0];
              if (site === 'message') assert.equal(entry.message, '[REDACTED]');
              else if (site === 'context-key') assert.equal(entry.context[key], '[REDACTED]');
              else if (site === 'context-value') assert.equal(entry.context.note, '[REDACTED]');
              else if (compression === 'snappy') assert.ok(wire.selectors[0].includes('note="[REDACTED]"'));
              else assert.equal(wire.selectors[0].note, '[REDACTED]');
            }
          } catch (error) { failures.push({ ...row, error: error.message }); }
          rows.push(row); await api.destroy();
        }
        for (const message of ['ordinary\ud83d\ude00\u00a0\ufeff', 'Bearer\u00a0synthetic-unicode', 'Bearer\ufeffsynthetic-unicode']) {
          const config = options(target.url); config.transport.compression = compression;
          if (generic) config.filter = { sensitivePatterns: [...core.DEFAULTS, /unmatchable(?:custom)/u] };
          const logger = api.init(config); logger.info(message, { note: 'ordinary\ud83d\ude00\u00a0\ufeff' }); await logger.flush();
          const entry = (await decode(target.requests.at(-1))).rows[0];
          assert.equal(entry.message, message.startsWith('Bearer') ? '[REDACTED]' : message);
          assert.equal(entry.context.note, 'ordinary\ud83d\ude00\u00a0\ufeff');
          assert.deepEqual(logger.getHealth().privacyCodes, []); await api.destroy();
        }
      }
      if (process.env.LEGACY_UTF16_REPORT === '1') console.log('LEGACY_UTF16_RESULTS ' + JSON.stringify({ rows, failures, validControls: 12 }));
      assert.equal(rows.length, 48); assert.deepEqual(failures, [], JSON.stringify(failures));
    } finally { await target.close(); }
  });

  test('unsupported live input is fail-closed with enum health while ordinary 500-scalar input remains supported', async () => {
    const target = await receiver();
    try {
      const ordinary = Object.fromEntries(Array.from({ length: 500 }, (_, i) => ['field' + i, 'ordinary']));
      const logger = api.init(options(target.url)); logger.info('ordinary-envelope', Object.freeze(ordinary)); await logger.flush();
      const entry = (await decode(target.requests[0])).rows[0];
      const retained = Object.entries(entry.context).filter(([key]) => key.startsWith('field'));
      assert.ok(retained.length > 0 && retained.length <= 500);
      assert.ok(retained.every(([, value]) => value === 'ordinary'));
      assert.equal(Object.keys(ordinary).length, 500);
      assert.deepEqual(logger.getHealth().privacyCodes, []);
      const scalarPolicy = new core.Policy({ sensitive: core.DEFAULTS, builtins: core.BUILTINS });
      const scalarCall = scalarPolicy.begin();
      try {
        for (const [key, value] of Object.entries(ordinary)) { assert.equal(scalarPolicy.sensitiveKey(key, scalarCall), false); assert.equal(scalarPolicy.privacy(value, scalarCall), false); }
        assert.equal(scalarCall.failed, false);
      } finally { scalarCall.close(); scalarPolicy.close(); }
      await api.destroy();
      const guarded = api.init({ ...options(target.url), filter: { sensitivePatterns: [/[^\x00-\x7f]/] } });
      guarded.info('ordinary', Object.freeze({ note: '\ud83d\ude00' })); await guarded.flush();
      assert.equal((await decode(target.requests.at(-1))).text.includes('\ud83d\ude00'), false);
      assert.ok(guarded.getHealth().privacyCodes.includes('ELVEN_MATCHER_UNSUPPORTED_INPUT'));
      assert.equal(guarded.getHealth().healthy, false);
      const health = JSON.stringify(guarded.getHealth()); assert.equal(health.includes('[^'), false);
    } finally { await target.close(); }
  });

  test('legacy order and explicit-only key role survive while compiled rule snapshots leave caller state alone', async () => {
    const target = await receiver();
    try {
      const global = /secret/g; global.lastIndex = 1;
      assert.equal(detectSensitiveData('secret', [global]), true); assert.equal(global.lastIndex, 1);
      assert.equal(sanitizeData({ password: 'ordinary' }, []).password, 'ordinary');
      assert.equal(sanitizeData({ note: 'private-person@example.test' }, []).note, '[REDACTED]');
      const keys = sanitizeData({ 'private-person@example.test': 'ordinary' }, [/password/i]);
      assert.equal(keys['private-person@example.test'], 'ordinary');
      const rules = [/^keep$/];
      const logger = api.init({ ...options(target.url), filter: { patterns: rules } }); rules.length = 0;
      logger.info('drop'); logger.info('keep'); await logger.flush();
      assert.equal(logger.getMetrics().logsDropped, 1); assert.equal((await decode(target.requests[0])).rows.length, 1);
      await api.destroy();
      for (const [pattern, count] of [[/^\[REDACTED\]$/, 1], [/^Authorization:/, 0]]) {
        const next = api.init({ ...options(target.url), filter: { patterns: [pattern] } });
        next.info('Authorization: Bearer synthetic-value');
        assert.equal(next.getMetrics().logsProcessed, count); await api.destroy();
      }
    } finally { await target.close(); }
  });

  test('unsupported source and count boundaries reject before pipeline and closed matching never leaks raw values', () => {
    assert.ok(ConfigService.validate({ filter: { patterns: Array.from({ length: 33 }, () => /ordinary/) } }).includes('ELVEN_MATCHER_UNSUPPORTED_PATTERN'));
    assert.ok(ConfigService.validate({ filter: { patterns: [new RegExp('a'.repeat(300))] } }).includes('ELVEN_MATCHER_UNSUPPORTED_PATTERN'));
    assert.ok(ConfigService.validate({ filter: { sensitivePatterns: [/secret(?=value)/] } }).includes('ELVEN_MATCHER_UNSUPPORTED_PATTERN'));
    const policy = new core.Policy({ sensitive: [/ordinary/] }); const call = policy.begin(); policy.close();
    assert.equal(policy.privacy('ordinary', call), true); assert.equal(policy.include('ordinary', call), false); assert.equal(call.failed, true); call.close();
    assert.ok(policy.toJSON().codes.every(code => Object.values(core.CODES).includes(code)));
  });
}
