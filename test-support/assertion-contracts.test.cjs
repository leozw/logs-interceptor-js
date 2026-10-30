const assert = require('node:assert/strict');
const { test, mock } = require('node:test');
const { runInNewContext } = require('node:vm');
const path = require('node:path');
assert.ok(process.env.ELVEN_TEST_OUTPUT, 'Run through scripts/test.cjs --port-controls');
const helpers = require(path.join(process.env.ELVEN_TEST_OUTPUT, 'test-support/assertions.js'));

test('numeric operators reject coercion on either side without invoking valueOf', () => {
  const coercible = { valueOf() { throw new Error('must not coerce'); } };
  for (const value of ['0', '', null, undefined, true, false, new Number(0), [], coercible]) {
    for (const operator of [helpers.greaterOrEqual, helpers.lessThan]) {
      assert.throws(() => operator(value, 1), assert.AssertionError);
      assert.throws(() => operator(0, value), assert.AssertionError);
    }
  }
});

test('numeric operators preserve number/bigint, NaN and infinity comparisons', () => {
  helpers.greaterOrEqual(0n, 0); helpers.greaterOrEqual(Infinity, 1n);
  helpers.lessThan(-1n, 0); helpers.lessThan(0, Infinity);
  for (const operator of [helpers.greaterOrEqual, helpers.lessThan]) {
    assert.throws(() => operator(NaN, 1), assert.AssertionError);
    assert.throws(() => operator(1, NaN), assert.AssertionError);
  }
  assert.throws(() => helpers.lessThan(1, 1), assert.AssertionError);
});

test('rejects.toThrow preserves local, cross-realm, DOM and rejected-thrower errors', async () => {
  for (const error of [new Error('needle'), runInNewContext("new Error('needle')"), new DOMException('needle'), () => { throw 'needle'; }]) {
    await helpers.rejectsToThrow(Promise.reject(error));
    await helpers.rejectsToThrow(Promise.reject(error), 'need');
    await assert.rejects(helpers.rejectsToThrow(Promise.reject(error), 'absent'), assert.AssertionError);
  }
});

test('rejects.toThrow rejects plain rejection reasons and fulfilled promises', async () => {
  for (const reason of ['needle', null, undefined, true, 0, { message: 'needle' }, () => undefined]) {
    await assert.rejects(helpers.rejectsToThrow(Promise.reject(reason)), assert.AssertionError);
    await assert.rejects(helpers.rejectsToThrow(Promise.reject(reason), 'needle'), assert.AssertionError);
  }
  await assert.rejects(helpers.rejectsToThrow(Promise.resolve(new Error('needle'))), assert.AssertionError);
});

test('sync toThrow string checks preserve thrown-value message conversion', () => {
  for (const value of ['needle', { message: 'needle' }, runInNewContext("new Error('needle')")]) {
    helpers.throwsContaining(() => { throw value; }, 'need');
    assert.throws(() => helpers.throwsContaining(() => { throw value; }, 'absent'), assert.AssertionError);
  }
  assert.throws(() => helpers.throwsContaining(() => undefined, 'needle'), assert.AssertionError);
});

test('standard mocks retain arguments, return/throw, promises and receiver identity', async () => {
  const object = { value: 7, fn: mock.fn(function (value) { assert.equal(this, object); return this.value + value; }) };
  assert.equal(object.fn(2), 9); assert.deepEqual(object.fn.mock.calls[0].arguments, [2]);
  assert.equal(object.fn.mock.calls[0].this, object);
  const error = new Error('synthetic');
  const failing = mock.fn(() => { throw error; }); assert.throws(failing, value => value === error);
  assert.equal(failing.mock.calls.length, 1); assert.equal(failing.mock.calls[0].error, error);
  const asynchronous = mock.fn(async () => 42); assert.equal(await asynchronous(), 42);
  assert.equal(asynchronous.mock.calls.length, 1);
});

test('standard method spies restore original function and descriptor after failure', () => {
  const object = { fn(value) { return value + 1; } };
  const original = Object.getOwnPropertyDescriptor(object, 'fn');
  const spy = mock.method(object, 'fn', () => { throw new Error('synthetic'); });
  try { assert.throws(() => object.fn(7), /synthetic/); assert.deepEqual(spy.mock.calls[0].arguments, [7]); }
  finally { spy.mock.restore(); }
  assert.deepEqual(Object.getOwnPropertyDescriptor(object, 'fn'), original);
  assert.equal(object.fn(7), 8);
});
