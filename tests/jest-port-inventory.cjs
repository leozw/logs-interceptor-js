const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const original = fs.readFileSync(path.join(root, 'src/__tests__/integration.test.ts'), 'utf8');
const ported = fs.readFileSync(path.join(root, 'tests/legacy-integration-ported.test.cjs'), 'utf8');
const inventory = (file, text, testName, assertionName) => {
  const cases = [];
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === testName && ts.isStringLiteral(node.arguments[0])) {
      let assertions = 0;
      function count(child) {
        if (ts.isCallExpression(child) && (assertionName === 'expect' ? child.expression.getText(ast) === 'expect' : child.expression.getText(ast).startsWith('assert.'))) assertions++;
        ts.forEachChild(child, count);
      }
      count(node.arguments[1]);
      cases.push({ title: node.arguments[0].text, assertions });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return cases;
};
const before = inventory('original.ts', original, 'it', 'expect');
const after = inventory('ported.cjs', ported, 'test', 'assert');
assert.equal(before.length, 12);
assert.equal(after.length, 12);
for (let i = 0; i < before.length; i++) {
  assert.ok(after[i].title.endsWith(before[i].title));
  assert.equal(after[i].assertions, before[i].assertions, before[i].title);
}
console.log(JSON.stringify({ originalSha256: crypto.createHash('sha256').update(original).digest('hex'), cases: 12, assertions: before.reduce((sum, item) => sum + item.assertions, 0), mapping: before.map((item, i) => ({ ...item, ported: after[i].title })), intentionalFixtureChanges: 'Only loopback503 replaces external DNS/network failure; bounded cleanup added. No Jest mocks existed; original source/config retained as historical reference.' }, null, 2));
