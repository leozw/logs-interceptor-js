// Optional inventory-only preload: every assertion delegates to the real builtin.
const assert = require('node:assert/strict');
const { beforeEach, afterEach } = require('node:test');
let active = false, count = 0;
for (const name of ['strictEqual', 'notStrictEqual', 'deepStrictEqual', 'ok', 'throws', 'doesNotThrow', 'rejects']) {
  const original = assert[name];
  assert[name] = function (...args) { if (active) count++; return Reflect.apply(original, this, args); };
}
beforeEach(() => { active = true; count = 0; });
afterEach(context => {
  active = false;
  process.stdout.write('__ELVEN_ASSERT_INVENTORY__' + JSON.stringify({ name: context.name, assertions: count }) + '\n');
});
