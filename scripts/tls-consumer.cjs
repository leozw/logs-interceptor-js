'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { createRequire } = require('node:module');
const root = path.resolve(process.argv[2]), fixture = path.resolve(process.argv[3]), trusted = process.argv[4] === 'trusted';
const use = createRequire(path.join(root, 'package.json'));
const api = use('elven-logs-interceptor');
const guard = setTimeout(() => process.exit(124), 5000);
const bodies = [];
const server = https.createServer({ key: fs.readFileSync(path.join(fixture, 'key.pem')), cert: fs.readFileSync(path.join(fixture, 'cert.pem')) }, (req, res) => {
  const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => { bodies.push(Buffer.concat(chunks)); res.end(); });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const logger = api.init({ appName: 'tls-consumer', transport: { type: 'otlp', url: `https://127.0.0.1:${server.address().port}`, timeout: 300, maxRetries: 0, compression: 'none' }, buffer: { autoFlush: false } });
  logger.info('TLS privacy control', { password: 'synthetic-tls-private' });
  if (trusted) {
    await logger.flush(); assert.equal(bodies.length, 1);
    assert.equal(bodies[0].includes(Buffer.from('synthetic-tls-private')), false);
    assert.equal(bodies[0].includes(Buffer.from('TLS privacy control')), true);
  } else { await assert.rejects(logger.flush()); assert.equal(bodies.length, 0); }
  process.stdout.write(JSON.stringify({ status: 'PASS', trusted, requests: bodies.length, node: process.version }) + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await api.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); clearTimeout(guard);
});
