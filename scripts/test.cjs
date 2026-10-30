const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), parent = path.join(root, '.test-dist');
fs.mkdirSync(parent, { recursive: true });
const output = fs.mkdtempSync(path.join(parent, 'run-'));
try {
  const compile = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--project', 'tsconfig.tests.json', '--outDir', output], { cwd: root, stdio: 'inherit' });
  if (compile.status !== 0) { process.exitCode = compile.status || 1; }
  else {
    const core = path.join(output, 'src/infrastructure/privacy/matcher-core.cjs');
    fs.mkdirSync(path.dirname(core), { recursive: true });
    fs.copyFileSync(path.join(root, 'src/infrastructure/privacy/matcher-core.cjs'), core);
    fs.cpSync(path.join(root, 'src/__tests__/fixtures'), path.join(output, 'src/__tests__/fixtures'), { recursive: true });
    const controls = process.argv.includes('--port-controls');
    const args = process.argv.slice(2).filter(arg => arg !== '--port-controls');
    const files = controls ? [path.join(root, 'test-support/assertion-contracts.test.cjs')] : fs.readdirSync(path.join(output, 'src/__tests__')).filter(file => file.endsWith('.test.js')).sort().map(file => path.join(output, 'src/__tests__', file));
    const run = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...args, ...files], { cwd: root, stdio: 'inherit', env: { ...process.env, ELVEN_TEST_OUTPUT: output } });
    process.exitCode = run.status || (run.signal || run.error ? 1 : 0);
  }
} finally { fs.rmSync(output, { recursive: true, force: true }); }
