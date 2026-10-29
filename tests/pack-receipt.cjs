const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'release');
fs.mkdirSync(directory, { recursive: true });
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
assert.equal(pkg.name, 'logs-interceptor');
assert.equal(pkg.version, '2.1.7');
assert.equal(pkg.publishConfig.provenance, true);
assert.equal(pkg.publishConfig.registry, 'https://registry.npmjs.org/');
const [packed] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', directory, '--json'], { cwd: root, encoding: 'utf8' }));
const files = new Set(packed.files.map(file => file.path));
for (const file of ['dist/index.js', 'dist/index.d.ts', 'preload.js', 'RECOVERY.md', 'AUDIT-LEGACY.md']) assert.ok(files.has(file), file);
assert.ok(![...files].some(file => /(^|\/)(\.env|\.npmrc|node_modules)(\/|$)/.test(file)));
const archive = fs.readFileSync(path.join(directory, packed.filename));
const receipt = {
  name: pkg.name, version: pkg.version,
  source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  lockSha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'package-lock.json'))).digest('hex'),
  node: process.version, filename: packed.filename,
  sha256: createHash('sha256').update(archive).digest('hex'),
  integrity: packed.integrity, files: [...files],
  publication: 'NOT PERFORMED; reviewed legacy source/ref and matching hosted provenance release path still required',
};
fs.writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ name: receipt.name, version: receipt.version, sha256: receipt.sha256 }));
