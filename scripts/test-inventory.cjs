const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..'), support = path.join(root, 'test-support');
const inventory = require('../test-support/port-inventory.json');
const run = spawnSync(process.execPath, [path.join(__dirname, 'test.cjs'), '--require=' + path.join(support, 'count-assertions.cjs'), '--test-reporter=' + path.join(support, 'reporter.cjs')], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
if (run.status !== 0) { process.stdout.write(run.stdout || ''); process.stderr.write(run.stderr || ''); throw run.error || new Error('Inventory test run failed'); }
const events = run.stdout.trim().split('\n').map(line => JSON.parse(line));
const counts = [], pending = new Map();
for (const event of events) {
  if (event.type !== 'test:stdout') continue;
  const key = event.data.file || '', lines = ((pending.get(key) || '') + event.data.message).split('\n');
  pending.set(key, lines.pop());
  for (const line of lines) if (line.startsWith('__ELVEN_ASSERT_INVENTORY__')) counts.push(JSON.parse(line.slice('__ELVEN_ASSERT_INVENTORY__'.length)));
}
for (const tail of pending.values()) assert.ok(!tail.includes('__ELVEN_ASSERT_INVENTORY__'), 'Incomplete assertion inventory');
const stack = [], cases = [];
for (const event of events) {
  if (event.type === 'test:start') { stack[event.data.nesting] = event.data.name; stack.length = event.data.nesting + 1; }
  if (event.type === 'test:pass' && event.data.details.type !== 'suite') cases.push({ name: event.data.name, title: [...stack.slice(0, event.data.nesting), event.data.name].join(' ') });
}
assert.equal(cases.length, counts.length);
const actual = new Map(cases.map((row, index) => { assert.equal(row.name, counts[index].name); return [row.title, counts[index].assertions]; }));
for (const row of inventory.caseInventory) assert.ok(actual.has(row.title) && actual.get(row.title) >= row.oldAssertions, 'Missing/weakened original assertions: ' + row.title);
for (const file of inventory.files) {
  const source = fs.readFileSync(path.join(root, 'src/__tests__', file.file), 'utf8');
  assert.doesNotMatch(source, /\bjest\.|\bexpect\(|\b(?:test|it|describe)\.(?:skip|only)\b/);
  const tree = ts.createSourceFile(file.file, source, ts.ScriptTarget.Latest, true);
  let sites = 0;
  function visit(node) {
    if (ts.isCallExpression(node) && ((ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(tree) === 'assert') || (ts.isIdentifier(node.expression) && ['greaterOrEqual', 'lessThan', 'rejectsToThrow', 'throwsContaining'].includes(node.expression.text)))) sites++;
    ts.forEachChild(node, visit);
  }
  visit(tree); assert.ok(sites >= file.oldAssertionSites, 'Missing original assertion sites: ' + file.file);
}
console.log(JSON.stringify({ originalCases: inventory.cases, currentCases: cases.length, originalAssertions: inventory.dynamicAssertions, currentAssertions: [...actual.values()].reduce((sum, count) => sum + count, 0), originalAssertionSites: inventory.assertionSites }));
const controls = spawnSync(process.execPath, [path.join(__dirname, 'test.cjs'), '--port-controls'], { cwd: root, stdio: 'inherit', timeout: 30_000 });
process.exitCode = controls.status || (controls.signal || controls.error ? 1 : 0);
