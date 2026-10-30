'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { contracts } = require('./matcher-contracts.cjs');
const { Policy, LIMITS, CODES, BUILTINS, DEFAULTS } = require('../dist/infrastructure/privacy/matcher-core.cjs');

test('70 native subset, replacement and explicit fail-closed contracts', () => {
  const result = contracts();
  assert.equal(result.counts.total, 70);
  assert.equal(result.counts.fail, 0, JSON.stringify(result.rows.filter(row => row.status === 'FAIL')));
  const native = new Set(['bearer-nbsp', 'bearer-bom', 'basic-nbsp', 'nonunicode-literal-emoji-input']);
  for (const row of result.rows) if (row.nativeInputCalls && !native.has(row.id)) {
    assert.fail('Uncertified input reached JS RegExp: ' + row.id);
  }
});

test('ordinary BMP JS whitespace semantics, with lone surrogates explicitly rejected', () => {
  const policy = new Policy({ sensitive: [/\s/] });
  let rejected = 0;
  for (let n = 0; n < 65536; n++) {
    const value = String.fromCharCode(n), call = policy.begin();
    const actual = policy.privacy(value, call);
    if (n >= 0xd800 && n <= 0xdfff) {
      assert.equal(actual, true); assert.equal(call.failed, true); rejected++;
    } else {
      assert.equal(actual, /\s/.test(value), 'BMP code point ' + n); assert.equal(call.failed, false);
    }
    call.close();
  }
  assert.equal(rejected, 2048);
  assert.deepEqual(policy.toJSON().codes, [CODES.input]);
  policy.close();
});

test('record and instruction budgets fail closed and cannot become negative', () => {
  const policy = new Policy({ sensitive: [/a|b/] }), call = policy.begin();
  policy.privacy('a'.repeat(LIMITS.inputPerRecord), call);
  assert.equal(policy.privacy('another', call), true);
  assert.equal(call.failed, true);
  assert.ok(call.remainingWork >= 0 && call.remainingUnits >= 0);
  assert.ok(policy.toJSON().codes.includes(CODES.work));
  call.close(); policy.close();
});

test('default pipeline has no backend programs or DFA allocation', () => {
  const policy = new Policy({ sensitive: DEFAULTS, builtins: BUILTINS }), call = policy.begin();
  assert.equal(policy.privacy('person@example.invalid', call), true);
  assert.equal(policy.privacy('Bearer\u00a0synthetic', call), true);
  assert.equal(policy.privacy('Bearer\ufeffsynthetic', call), true);
  assert.equal(policy.toJSON().stats.engineCompiles, 0);
  assert.equal(policy.toJSON().stats.dfaBytes, 0);
  assert.equal(policy.toJSON().stats.nativeRules, 14);
  call.close(); policy.close();
});

test('64 compiled plans respect program and DFA cache budgets under state pressure', () => {
  const patterns = Array.from({ length: 32 }, () => /[ab]*a[ab]{10}/);
  const policy = new Policy({ sensitive: patterns, selectors: patterns });
  assert.equal(policy.toJSON().ready, true);
  assert.equal(policy.toJSON().stats.engineCompiles, 64);
  assert.ok(policy.toJSON().stats.programInstructions <= LIMITS.instructionsTotal);
  assert.ok(policy.toJSON().stats.dfaBytes <= LIMITS.dfaBytesTotal);
  let seed = 0x12345678, text = '';
  for (let i = 0; i < 4096; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; text += seed & 0x10000 ? 'a' : 'b'; }
  const call = policy.begin();
  for (const role of ['sensitive', 'selectors']) for (let i = 0; i < 32; i++) {
    assert.equal(policy.testRule(role, i, text, call), true);
    const dfa = policy.roles[role][i].set.dfa;
    assert.equal(dfa.maxMem, LIMITS.dfaBytesPerRule);
    assert.ok(dfa.memBudget >= 0 && dfa.memBudget <= LIMITS.dfaBytesPerRule);
  }
  assert.equal(call.failed, false);
  call.close(); policy.close();
  assert.equal(policy.toJSON().closed, true);
  assert.deepEqual(policy.roles, { sensitive: [], selectors: [] });
});
