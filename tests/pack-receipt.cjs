const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), '', 'Review archives require clean committed source');
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const directory = path.join(root, 'release', '3.0.0', source);
fs.mkdirSync(directory, { recursive: true });
fs.mkdirSync(path.join(root, '.rebuild'), { recursive: true });
const scratch = fs.mkdtempSync(path.join(root, '.rebuild/pack-'));
const home = path.join(scratch, 'home');
fs.mkdirSync(home);
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
assert.equal(pkg.name, 'logs-interceptor');
assert.equal(pkg.version, '3.0.0');
assert.equal(pkg.publishConfig.provenance, true);
assert.equal(pkg.publishConfig.registry, 'https://registry.npmjs.org/');
assert.equal(pkg.publishConfig.tag, 'next');
const [packed] = JSON.parse(execFileSync('npm', ['pack', '--offline', '--update-notifier=false', '--ignore-scripts', '--pack-destination', scratch, '--json', '--userconfig=/dev/null', '--globalconfig=' + path.join(home, 'global.npmrc'), '--cache=' + path.join(scratch, 'cache'), '--registry=https://registry.npmjs.org/'], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: home } }));
const files = new Set(packed.files.map(file => file.path));
for (const file of ['dist/index.js', 'dist/index.d.ts', 'preload.js', 'RECOVERY.md', 'AUDIT-LEGACY.md', 'AUDIT-LEGACY-FOLLOWUP.md', 'AUDIT-MATCHER.md', 'AUDIT-CONFIG-ADMISSION.md', 'dist/infrastructure/privacy/matcher-core.cjs', 'dist/infrastructure/privacy/shared-core.json']) assert.ok(files.has(file), file);
assert.ok(![...files].some(file => /(^|\/)(\.env|\.npmrc|node_modules)(\/|$)/.test(file)));
assert.ok(![...files].some(file => /(^|\/)(__tests__|tests)(\/|$)|\.(test|spec)\.[cm]?js$/.test(file)), 'Stale test outputs in archive');
const archive = fs.readFileSync(path.join(scratch, packed.filename));
const destination = path.join(directory, packed.filename);
if (fs.existsSync(destination)) assert.deepEqual(fs.readFileSync(destination), archive, 'Existing reviewed archive differs; preserve it and use a fresh qualification workspace');
else fs.copyFileSync(path.join(scratch, packed.filename), destination);
const receipt = {
  name: pkg.name, version: pkg.version, tag: pkg.publishConfig.tag,
  source,
  lockSha256: createHash('sha256').update(fs.readFileSync(path.join(root, 'package-lock.json'))).digest('hex'),
  node: process.version, filename: packed.filename,
  sha256: createHash('sha256').update(archive).digest('hex'),
  integrity: packed.integrity, files: [...files],
  engines: pkg.engines,
  sharedCore: JSON.parse(fs.readFileSync(path.join(root, 'src/infrastructure/privacy/shared-core.json'))),
  publication: 'HOLD; source/runtime review and npm ownership/provenance authorization remain required. No publication performed.',
};
const receiptFile = path.join(directory, 'receipt.json');
if (!fs.existsSync(receiptFile)) fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ name: receipt.name, version: receipt.version, sha256: receipt.sha256 }));
