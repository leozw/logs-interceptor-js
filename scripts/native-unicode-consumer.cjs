'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(process.argv[2]), use = createRequire(path.join(root, 'package.json'));
const api = use('elven-logs-interceptor');
const { ConfigService } = use('elven-logs-interceptor/dist/application/services/ConfigService.js');
const rows = [], bodies = [], canary = 'PACKED_NATIVE_CANARY_57821';
const guard = setTimeout(() => process.exit(124), 10000);
const server = http.createServer((req, res) => {
  const chunks = []; req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => { bodies.push(Buffer.concat(chunks)); res.end(); });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const transport = { type: 'otlp', url: `http://127.0.0.1:${server.address().port}`, compression: 'none', maxRetries: 0 };
  const defaults = ConfigService.resolve({ appName: 'native-packed', transport }).filter.sensitivePatterns;
  for (const mode of ['default', 'generic-control']) {
    for (const site of ['message', 'selector', 'context-key', 'context-value', 'record-label', 'resource']) for (const broken of ['\ud800', '\udc00']) {
      const payload = broken + '{"pass\\u0077ord":"' + canary + '"}';
      const context = Object.freeze(site === 'context-key' ? { [broken + 'field']: canary } : site === 'context-value' ? { field: payload } : {});
      const labels = Object.freeze(site === 'resource' ? { note: payload } : {});
      const before = bodies.length;
      const logger = api.init({ appName: 'native-packed', transport, labels, buffer: { autoFlush: false },
        dynamicLabels: site === 'record-label' ? { note: () => payload } : {},
        filter: { ...(mode === 'generic-control' ? { sensitivePatterns: [...defaults, /NEVER_GENERIC_MATCH_491/] } : {}), ...(site === 'selector' ? { patterns: [/token/i] } : {}) } });
      logger.info(site === 'selector' ? broken + 'token ' + payload : site === 'message' ? payload : 'ordinary event', context);
      await logger.flush();
      assert.equal(bodies.length - before, site === 'selector' ? 0 : 1);
      const wire = Buffer.concat(bodies.slice(before)); assert.equal(wire.includes(Buffer.from(canary)), false);
      assert.deepEqual(logger.getHealth().privacyDiagnostics, ['ELVEN_MATCHER_UNSUPPORTED_INPUT']);
      assert.equal(logger.getHealth().healthy, false);
      const state = logger.filter.matcher.core.toJSON();
      if (mode === 'default') {
        assert.equal(state.stats.engineCompiles, 0); assert.equal(state.stats.programInstructions, 0); assert.equal(state.stats.dfaBytes, 0);
      }
      assert.equal(Object.isFrozen(context), true); assert.equal(Object.isFrozen(labels), true);
      rows.push({ mode, site, surrogate: broken === '\ud800' ? 'high' : 'low', requests: bodies.length - before, wireBytes: wire.length, status: 'PASS', diagnostics: logger.getHealth().privacyDiagnostics, stats: state.stats });
      await api.destroy();
    }
    if (mode === 'default') {
      assert.equal(require.cache[use.resolve('re2js')], undefined);
      assert.equal(require.cache[use.resolve('@eslint-community/regexpp')], undefined);
    }
  }
  const logger = api.init({ appName: 'valid-unicode', transport, buffer: { autoFlush: false } });
  const message = 'ordinary \ud83d\ude00 \u00a0 \ufeff'; logger.info(message); await logger.flush();
  assert.equal(bodies.at(-1).includes(Buffer.from(message)), true); assert.deepEqual(logger.getHealth().privacyDiagnostics, []);
  await api.destroy();
  process.stdout.write(JSON.stringify({ status: 'PASS', node: process.version, rows, validAstralAndSpace: true }) + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await api.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); clearTimeout(guard);
});
