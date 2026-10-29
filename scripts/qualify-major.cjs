const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.rebuild/major3-qualification');
fs.mkdirSync(output, { recursive: true });
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const environment = { PATH: '/usr/bin:/bin', HOME: path.join(root, '.rebuild/home') };
const evidence = path.dirname(root);
const results = [];

async function floorBinary() {
  assert.equal(process.platform, 'darwin');
  assert.equal(process.arch, 'arm64');
  const name = 'node-v18.17.0-darwin-arm64';
  const file = name + '.tar.gz';
  const url = `https://nodejs.org/dist/v18.17.0/${file}`;
  const sumResponse = await fetch('https://nodejs.org/dist/v18.17.0/SHASUMS256.txt', { signal: AbortSignal.timeout(30000) });
  assert.equal(sumResponse.status, 200);
  const sums = await sumResponse.text();
  const line = sums.split('\n').find(row => row.trim().split(/\s+/)[1] === file);
  assert.ok(line, 'Official Node18.17.0 archive checksum');
  const expected = line.trim().split(/\s+/)[0];
  const archive = path.join(output, file);
  if (!fs.existsSync(archive) || sha(fs.readFileSync(archive)) !== expected) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(sha(bytes), expected);
    fs.writeFileSync(archive, bytes);
  }
  const node = path.join(output, name, 'bin/node');
  if (!fs.existsSync(node)) execFileSync('tar', ['-xzf', archive, '-C', output]);
  fs.writeFileSync(path.join(output, 'node18.17-source.json'), JSON.stringify({ capturedAt: new Date().toISOString(), url, sha256: expected, verification: 'Official HTTPS SHASUMS256 match; release signature not separately verified', binary: node, profile: 'EOL compatibility only, not security support' }, null, 2) + '\n');
  return node;
}

async function graph() {
  const lockBytes = fs.readFileSync(path.join(root, 'package-lock.json'));
  const lock = JSON.parse(lockBytes);
  assert.equal(lock.version, '3.0.0');
  assert.equal(lock.packages[''].engines.node, '>=18.17.0');
  const all = {};
  const prod = {};
  for (const [file, value] of Object.entries(lock.packages)) {
    if (!file || value.link) continue;
    const name = value.name || file.slice(file.lastIndexOf('node_modules/') + 13);
    assert.ok(!['jest', 'ts-jest', '@types/jest', 'deepmerge'].includes(name));
    (all[name] ??= []).push(value.version);
    if (!value.dev) (prod[name] ??= []).push(value.version);
  }
  for (const name of ['jest', 'ts-jest', '@types/jest', 'deepmerge']) assert.equal(fs.existsSync(path.join(root, 'node_modules', name)), false);
  const audits = {};
  const versionResponse = await fetch('https://registry.npmjs.org/logs-interceptor/3.0.0', { signal: AbortSignal.timeout(30000) });
  assert.equal(versionResponse.status, 404, 'Review version must not already exist in the public registry');
  for (const [name, packages] of Object.entries({ prod, all })) {
    const response = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(packages), signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200);
    audits[name] = await response.json();
  }
  const record = { at: new Date().toISOString(), lockSha256: sha(lockBytes), packageVersion: lock.version, engines: lock.packages[''].engines, declaredPackages: Object.keys(lock.packages).length - 1, removedDevelopmentPaths: ['jest', 'ts-jest', '@types/jest', 'deepmerge'], advisoryBulk: audits, public300Status: versionResponse.status, registryOwnershipAuthorization: 'HOLD_PARENT; public404 is not ownership, permission or reservation', credentialsAccessed: false, caveat: 'Dated official anonymous package/version advisory matches, not zero-CVE or complete source safety. Historical Jest source/config preserved, not active dependencies.' };
  fs.writeFileSync(path.join(output, 'graph.json'), JSON.stringify(record, null, 2) + '\n');
  assert.deepEqual(Object.keys(audits.prod), []);
  assert.deepEqual(Object.keys(audits.all), []);
}

(async () => {
  await graph();
  const floor = await floorBinary();
  const testFiles = fs.readdirSync(path.join(root, 'tests')).filter(file => file.endsWith('.test.cjs')).sort().map(file => path.join(root, 'tests', file));
  const profiles = [
    { name: '18.17.0-exact-eol', node: floor },
    ...[20, 22, 24, 26].map(major => ({ name: String(major), node: path.join(evidence, `runtimes/node${major}/node_modules/node/bin/node`) })),
  ];
  for (const profile of profiles) {
    const version = execFileSync(profile.node, ['--version'], { env: environment, encoding: 'utf8' }).trim();
    const started = Date.now();
    const result = spawnSync(profile.node, ['--test', '--test-reporter=tap', ...testFiles], { cwd: root, env: environment, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    const log = `runtime-${profile.name}.log`;
    fs.writeFileSync(path.join(output, log), result.stdout + result.stderr);
    const count = Number(result.stdout.match(/# tests (\d+)/)?.[1]);
    const record = { profile: profile.name, version, status: result.status, signal: result.signal, error: result.error?.message, tests: count, elapsedMs: Date.now() - started, log, platform: process.platform, arch: process.arch, securitySupport: version.startsWith('v18.') || version.startsWith('v20.') ? 'EOL_COMPATIBILITY_ONLY' : 'MAINTAINED_PROFILE' };
    results.push(record);
    fs.writeFileSync(path.join(output, 'runtime-matrix.json'), JSON.stringify({ capturedAt: new Date().toISOString(), source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), dirtyAtQualification: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !== '', records: results, publication: 'HOLD_AUTHORIZATION_FRESH_CI_AND_INDEPENDENT_REVIEW' }, null, 2) + '\n');
    console.log(JSON.stringify(record));
    assert.equal(result.status, 0, 'Runtime failed; see ' + log);
    assert.equal(count, 30);
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
