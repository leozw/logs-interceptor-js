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
      const operators = [];
      function count(child) {
        if (ts.isCallExpression(child) && (assertionName === 'expect' ? child.expression.getText(ast) === 'expect' : child.expression.getText(ast).startsWith('assert.'))) {
          assertions++;
          if (assertionName === 'expect') {
            const names = []; let current = child;
            while (ts.isPropertyAccessExpression(current.parent) && current.parent.expression === current) {
              current = current.parent; names.push(current.name.text);
            }
            operators.push(names.join('.'));
          } else operators.push(child.expression.getText(ast));
        }
        ts.forEachChild(child, count);
      }
      count(node.arguments[1]);
      cases.push({ title: node.arguments[0].text, assertions, operators });
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
const operatorMap = { toBeDefined: 'assert.notEqual', toBe: 'assert.equal', 'not.toThrow': 'assert.doesNotThrow', toThrow: 'assert.throws', 'rejects.toThrow': 'assert.rejectsToThrow', toBeGreaterThanOrEqual: 'assert.greaterThanOrEqual' };
for (let i = 0; i < before.length; i++) {
  assert.ok(after[i].title.endsWith(before[i].title));
  assert.equal(after[i].assertions, before[i].assertions, before[i].title);
  assert.deepEqual(after[i].operators, before[i].operators.map(operator => { assert.ok(operatorMap[operator], operator); return operatorMap[operator]; }), before[i].title);
}
console.log(JSON.stringify({ originalSha256: crypto.createHash('sha256').update(original).digest('hex'), cases: 12, assertions: before.reduce((sum, item) => sum + item.assertions, 0), mapping: before.map((item, i) => ({ ...item, ported: after[i].title, portedOperators: after[i].operators })), helperCounterCases: 'Numeric type/coercion, NaN, bigint, cross-realm Error/DOMException, rejected throwing/nonthrowing callbacks and fulfillment have negative/positive native coverage.', semanticSources: ['https://raw.githubusercontent.com/jestjs/jest/v30.2.0/packages/expect/src/matchers.ts', 'https://raw.githubusercontent.com/jestjs/jest/v30.2.0/packages/expect/src/toThrowMatchers.ts', 'https://raw.githubusercontent.com/jestjs/jest/v30.2.0/packages/expect-utils/src/utils.ts'], intentionalFixtureChanges: 'Only loopback503 replaces external DNS/network failure; bounded cleanup added. Original clearAllMocks hook had no mock declarations/spies to reset; original source/config retained as historical reference.' }, null, 2));
