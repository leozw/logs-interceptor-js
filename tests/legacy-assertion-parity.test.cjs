const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const ported = require('./assert-jest-parity.cjs');

test('ported numeric and rejected-toThrow operators retain Jest types and callback behavior', async () => {
  for (const value of [0, 1, Infinity, 0n]) ported.greaterThanOrEqual(value, 0);
  for (const value of [undefined, null, false, '0', {}, NaN, -1]) assert.throws(() => ported.greaterThanOrEqual(value, 0), assert.AssertionError);
  assert.throws(() => ported.greaterThanOrEqual(0, '0'), assert.AssertionError);
  for (const reason of [new Error('synthetic'), new DOMException('synthetic'), vm.runInNewContext('new Error("synthetic")'), { [Symbol.toStringTag]: 'Exception' }, () => { throw undefined; }]) {
    await ported.rejectsToThrow(Promise.reject(reason));
  }
  for (const reason of [undefined, null, 'synthetic', 1, {}, () => {}]) {
    await assert.rejects(ported.rejectsToThrow(Promise.reject(reason)), assert.AssertionError);
  }
  await assert.rejects(ported.rejectsToThrow(Promise.resolve()), assert.AssertionError);
});
