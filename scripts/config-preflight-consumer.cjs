'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { runPublicConfigGate } = require('../test-support/config-preflight.cjs');
const product = path.resolve(process.argv[2]);
const pkg = require(path.join(product, 'package.json'));
assert.equal(pkg.name, 'elven-logs-interceptor'); assert.equal(pkg.version, '2.0.1');
const api = require(product);
const { MemoryDeadLetterQueue } = require(path.join(product, 'dist/infrastructure/dlq/MemoryDeadLetterQueue.js'));
const watchdog = setTimeout(() => { console.error('CONFIG_PREFLIGHT_25S_STOP'); process.exit(124); }, 25000);
(async () => {
  const result = await runPublicConfigGate(api);
  for (const capacity of [1.5, NaN, Infinity, -Infinity, 0, -1, 10001]) assert.throws(() => new MemoryDeadLetterQueue(capacity), { message: 'ELVEN_DLQ_CAPACITY_BUDGET' });
  for (const capacity of [undefined, 1, 1000, 10000]) {
    const queue = new MemoryDeadLetterQueue(capacity); await queue.add({ id: 'normal', timestamp: '', level: 'info', message: 'ordinary' }, 'test'); assert.equal(queue.size(), 1); await queue.clear();
  }
  console.log(JSON.stringify({ status: 'PASS', node: process.version, candidate: pkg.version, ...result, directDlqOnly: 'Invalid capacity is a conditional deep-component surface; root facade already validated it.' }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(watchdog));
