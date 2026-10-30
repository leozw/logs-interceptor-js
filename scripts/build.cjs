const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
// Only generated output inside this checkout is replaced; old release archives live elsewhere.
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc')], { cwd: root, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status || 1);
require('./copy-runtime.cjs');
