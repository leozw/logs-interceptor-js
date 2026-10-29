const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
// tsc does not remove outputs for sources that no longer exist.
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc')], { cwd: root, stdio: 'inherit' });
