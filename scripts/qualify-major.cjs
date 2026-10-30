const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const evidence = path.dirname(root);
const output = path.join(root, '.rebuild/legacy-config-admission-qualification');
fs.mkdirSync(path.join(output, 'home'), { recursive: true });
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const environment = { PATH: '/usr/bin:/bin', HOME: path.join(output, 'home') };
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const expectedTests = 61;

async function minimum() {
  assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'arm64');
  const name = 'node-v22.0.0-darwin-arm64';
  const archive = path.join(evidence, 'major-20261029/cache/node22-minimum', name + '.tar.gz');
  const node = path.join(path.dirname(archive), name, 'bin/node');
  const url = 'https://nodejs.org/dist/v22.0.0/SHASUMS256.txt';
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  const line = (await response.text()).split('\n').find(row => row.trim().split(/\s+/)[1] === name + '.tar.gz');
  assert.ok(line); const expected = line.trim().split(/\s+/)[0];
  assert.equal(sha(fs.readFileSync(archive)), expected);
  const binary = execFileSync('tar', ['-xOf', archive, name + '/bin/node'], { maxBuffer: 128 * 1024 * 1024 });
  assert.equal(sha(fs.readFileSync(node)), sha(binary));
  assert.equal(execFileSync(node, ['--version'], { env: environment, encoding: 'utf8' }).trim(), 'v22.0.0');
  fs.writeFileSync(path.join(output, 'minimum-node-source.json'), JSON.stringify({ capturedAt: new Date().toISOString(), node, archive, officialChecksumsUrl: url, archiveSha256: expected, extractedBinaryByteMatched: true, verification: 'Official HTTPS SHASUMS match; signature not separately verified', profile: 'Exact runtime compatibility floor, not recommended current security patch' }, null, 2) + '\n');
  return node;
}

async function graph() {
  const bytes = fs.readFileSync(path.join(root, 'package-lock.json'));
  const lock = JSON.parse(bytes);
  assert.equal(lock.version, '3.0.0'); assert.equal(lock.packages[''].engines.node, '>=22.0.0');
  assert.equal(lock.packages['node_modules/re2js'].version, '2.9.1');
  assert.equal(lock.packages['node_modules/@eslint-community/regexpp'].version, '4.12.2');
  const all = Object.create(null), prod = Object.create(null), components = [];
  for (const [file, pkg] of Object.entries(lock.packages)) {
    if (!file || pkg.link) continue;
    const name = pkg.name || file.slice(file.lastIndexOf('node_modules/') + 13);
    assert.ok(!['jest', 'ts-jest', '@types/jest', 'deepmerge', 'safe-regex2'].includes(name));
    (all[name] ??= []).push(pkg.version); if (!pkg.dev) (prod[name] ??= []).push(pkg.version);
    components.push({ type: 'library', 'bom-ref': file, name, version: pkg.version, scope: pkg.dev ? 'excluded' : 'required', purl: 'pkg:npm/' + name.replace('@', '%40') + '@' + pkg.version, properties: [{ name: 'npm:installationPath', value: file }, { name: 'npm:devOnly', value: String(!!pkg.dev) }] });
  }
  for (const name of ['jest', 'ts-jest', '@types/jest', 'deepmerge', 'safe-regex2']) assert.equal(fs.existsSync(path.join(root, 'node_modules', name)), false);
  const audits = {};
  for (const [scope, packages] of Object.entries({ prod, all })) {
    const response = await fetch('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(packages), signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200); audits[scope] = await response.json();
  }
  const version = await fetch('https://registry.npmjs.org/logs-interceptor/3.0.0', { signal: AbortSignal.timeout(30000) });
  const record = { capturedAt: new Date().toISOString(), source: git(['rev-parse', 'HEAD']), lockSha256: sha(bytes), engines: lock.packages[''].engines, declaredPackages: components.length, removedPaths: ['jest', 'ts-jest', '@types/jest', 'deepmerge', 'safe-regex2'], advisoryBulk: audits, public300Status: version.status, credentialsAccessed: false, caveat: 'Dated anonymous primary package/version matches, not zero-CVE or complete source safety. ESLint9 deprecation remains disclosed. Deepmerge upstream unfixed; active legacy development path removed, not old installed2.x fixed.', publication: 'HOLD_PARENT next-only authorization, independent and public provenance gates' };
  fs.writeFileSync(path.join(output, 'graph.json'), JSON.stringify(record, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'sbom.json'), JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.5', version: 1, metadata: { timestamp: new Date().toISOString(), component: { type: 'library', name: 'logs-interceptor', version: lock.version }, properties: [{ name: 'scope', value: 'Exact current lock component inventory, dev flags; not an AWS or SDK SBOM' }, { name: 'lockSha256', value: record.lockSha256 }] }, components }, null, 2) + '\n');
  assert.equal(version.status, 404, 'Identity must not already be published; public404 is not ownership or permission');
  assert.deepEqual(Object.keys(audits.prod), []); assert.deepEqual(Object.keys(audits.all), []);
}

(async () => {
  const origin = JSON.parse(fs.readFileSync(path.join(root, 'src/infrastructure/privacy/shared-core.json')));
  assert.equal(sha(fs.readFileSync(path.join(root, 'src/infrastructure/privacy/matcher-core.cjs'))), origin.sha256);
  assert.equal(sha(fs.readFileSync(path.join(root, 'src/infrastructure/privacy/MatcherPolicy.ts'))), origin.wrapperSha256);
  await graph();
  const floor = await minimum();
  const tests = fs.readdirSync(path.join(root, 'tests')).filter(file => file.endsWith('.test.cjs')).sort().map(file => path.join(root, 'tests', file));
  const profiles = [{ name: 'minimum22.0.0', node: floor }, ...[22, 24, 26].map(major => ({ name: String(major), node: path.join(evidence, `runtimes/node${major}/node_modules/node/bin/node`) }))];
  const records = [];
  for (const profile of profiles) {
    const version = execFileSync(profile.node, ['--version'], { env: environment, encoding: 'utf8' }).trim();
    const start = Date.now();
    const run = spawnSync(profile.node, ['--test', '--test-reporter=tap', ...tests], { cwd: root, env: environment, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
    const log = 'runtime-' + profile.name + '.log'; fs.writeFileSync(path.join(output, log), run.stdout + run.stderr);
    const count = Number(run.stdout.match(/# tests (\d+)/)?.[1]);
    records.push({ profile: profile.name, node: profile.node, version, status: run.status, signal: run.signal, tests: count, elapsedMs: Date.now() - start, log, platform: process.platform, arch: process.arch });
    fs.writeFileSync(path.join(output, 'runtime-matrix.json'), JSON.stringify({ capturedAt: new Date().toISOString(), source: git(['rev-parse', 'HEAD']), dirtyAtQualification: git(['status', '--porcelain']) !== '', expectedTests, records, publication: 'HOLD_INDEPENDENT_AUTH_PROVENANCE; not SDK3% or all-platform acceptance' }, null, 2) + '\n');
    console.log(JSON.stringify(records.at(-1))); assert.equal(run.status, 0); assert.equal(count, expectedTests);
  }
  for (const [name, args] of [
    ['strict-types', [path.join(root, 'node_modules/typescript/bin/tsc'), '--strict', '--skipLibCheck', '--noEmit', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2020', 'tests/typescript-contract.ts']],
    ['port-inventory', ['tests/jest-port-inventory.cjs']],
    ['lint', [path.join(root, 'node_modules/eslint/bin/eslint.js'), 'src/**/*.ts', '-f', 'json']],
  ]) {
    const run = spawnSync(process.execPath, args, { cwd: root, env: environment, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
    fs.writeFileSync(path.join(output, name + (name === 'lint' ? '.json' : '.log')), run.stdout + run.stderr); assert.equal(run.status, 0, name + ' gate failed');
  }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
