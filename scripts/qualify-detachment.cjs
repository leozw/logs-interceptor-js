'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const evidence = path.dirname(root);
const stage = process.argv[2] || 'source';
assert.ok(['source', 'artifact'].includes(stage));
const name = process.argv[3] || 'legacy-final-qualification';
assert.ok(['legacy-detachment-qualification', 'legacy-retry-qualification', 'legacy-final-qualification'].includes(name));
const out = path.join(root, '.rebuild', name);
fs.mkdirSync(path.join(out, 'home'), { recursive: true });
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const env = { PATH: '/usr/bin:/bin', HOME: path.join(out, 'home') };
const profiles = [
  { name: 'minimum22.0.0', node: path.join(evidence, 'major-20261029/cache/node22-minimum/node-v22.0.0-darwin-arm64/bin/node') },
  ...[22, 24, 26].map(n => ({ name: String(n), node: path.join(evidence, `runtimes/node${n}/node_modules/node/bin/node`) })),
];
assert.equal(sha(fs.readFileSync(profiles[0].node)), '9507031f6769f2381eae353b3614bafa871c957dc6f2ae86a3af948acdf9b178');
const report = { capturedAt: new Date().toISOString(), stage, source: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain']) !== '', lockSha256: sha(fs.readFileSync(path.join(root, 'package-lock.json'))), expectedTests: 54, network: 'No registry/network/install/credential/Docker operations. Historical audits are not refreshed.', records: [], freshRegistryAndLinuxCI: 'PENDING_PARENT', independentAcceptance: 'PENDING', publication: 'HOLD' };
function command(name, node, args, cwd) {
  const result = spawnSync(node, args, { cwd, env, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  const log = stage + '-' + name + '.log';
  fs.writeFileSync(path.join(out, log), (result.stdout || '') + (result.stderr || ''));
  const record = { name, node, version: execFileSync(node, ['--version'], { env, encoding: 'utf8' }).trim(), nodeSha256: sha(fs.readFileSync(node)), status: result.status, signal: result.signal, errorCode: result.error?.code, platform: process.platform, arch: process.arch, log };
  report.records.push(record);
  fs.writeFileSync(path.join(out, stage + '.json'), JSON.stringify(report, null, 2) + '\n');
  assert.equal(result.status, 0, name + ': see ' + log);
  return result.stdout;
}
const tests = fs.readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.test.cjs')).sort();
const identity = require(path.join(root, 'src/infrastructure/privacy/shared-core.json'));
assert.equal(sha(fs.readFileSync(path.join(root, 'src/infrastructure/privacy/matcher-core.cjs'))), identity.sha256);
assert.equal(sha(fs.readFileSync(path.join(root, 'src/infrastructure/privacy/MatcherPolicy.ts'))), identity.wrapperSha256);
assert.equal(sha(fs.readFileSync(path.join(root, 'src/infrastructure/memory/DetachedString.ts'))), identity.detachedStringSha256);
if (stage === 'source') {
  command('build', profiles[1].node, ['scripts/build.cjs'], root);
  for (const profile of profiles) {
    const stdout = command(profile.name, profile.node, ['--test', '--test-reporter=tap', ...tests.map(f => path.join(root, 'tests', f))], root);
    assert.equal(Number(stdout.match(/# tests (\d+)/)?.[1]), report.expectedTests);
    report.records.at(-1).tests = report.expectedTests;
  }
  command('types', profiles[0].node, [require.resolve('typescript/bin/tsc'), '--strict', '--skipLibCheck', '--noEmit', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2020', 'tests/typescript-contract.ts'], root);
  command('inventory', profiles[0].node, ['tests/jest-port-inventory.cjs'], root);
  command('lint', profiles[1].node, [path.join(root, 'node_modules/eslint/bin/eslint.js'), 'src/**/*.ts', '-f', 'json'], root);
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json')));
  const components = Object.entries(lock.packages).filter(([p]) => p).map(([p, v]) => ({ path: p, name: v.name || p.slice(p.lastIndexOf('node_modules/') + 13), version: v.version, dev: !!v.dev }));
  assert.ok(!components.some(c => ['jest', 'ts-jest', '@types/jest', 'deepmerge', 'safe-regex2'].includes(c.name)));
  report.graph = { components: components.length, lockUnchangedFrom9369: report.lockSha256 === '6d144b677f61dda8cf17f1eb74886182ef704dce4b1395274107809102eb3365', inventory: 'components.json', advisoryFreshness: 'No new registry scan; previous dated prod/all results do not prove no vulnerabilities.' };
  fs.writeFileSync(path.join(out, 'components.json'), JSON.stringify(components, null, 2));
} else {
  assert.equal(report.dirty, false, 'Pack/review requires committed clean source');
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'release/3.0.0', report.source, 'receipt.json')));
  const archive = path.join(root, 'release/3.0.0', report.source, receipt.filename);
  assert.equal(sha(fs.readFileSync(archive)), receipt.sha256);
  const old = path.join(root, '.rebuild/packed-consumer-CeJWjK/node_modules');
  const consumer = fs.mkdtempSync(path.join(out, 'consumer-'));
  fs.mkdirSync(path.join(consumer, 'node_modules'));
  for (const entry of fs.readdirSync(old)) {
    if (['logs-interceptor', '.package-lock.json'].includes(entry)) continue;
    fs.cpSync(path.join(old, entry), path.join(consumer, 'node_modules', entry), { recursive: true, verbatimSymlinks: true });
  }
  const installed = path.join(consumer, 'node_modules/logs-interceptor'); fs.mkdirSync(installed);
  execFileSync('tar', ['-xzf', archive, '--strip-components=1', '-C', installed]);
  for (const file of receipt.files) assert.equal(sha(fs.readFileSync(path.join(installed, file))), sha(execFileSync('tar', ['-xOf', archive, 'package/' + file], { maxBuffer: 2 * 1024 * 1024 })));
  const baselineFiles = execFileSync('tar', ['-tzf', path.join(evidence, 'artifacts/logs-interceptor-2.1.6.tgz')], { encoding: 'utf8' }).trim().split('\n').filter(f => /^package\/(?:dist\/.*\.(?:js|d\.ts)|preload\.js)$/.test(f) && !/\/__tests__\//.test(f)).map(f => f.slice(8));
  for (const file of baselineFiles) assert.ok(receipt.files.includes(file), 'Historical public path lost: ' + file);
  fs.symlinkSync('node_modules/logs-interceptor/dist', path.join(consumer, 'dist'));
  fs.symlinkSync('node_modules/logs-interceptor/preload.js', path.join(consumer, 'preload.js'));
  fs.cpSync(path.join(root, 'tests'), path.join(consumer, 'tests'), { recursive: true });
  report.consumer = consumer; report.archiveSha256 = receipt.sha256; report.archiveFiles = receipt.files.length; report.baselinePathsPresent = baselineFiles.length;
  report.freshInstall = false; report.dependencyMode = 'Offline staged prior hash-bound compatible production graph, not a fresh registry resolution.';
  command('installed-types', profiles[0].node, [require.resolve('typescript/bin/tsc'), '--strict', '--skipLibCheck', '--noEmit', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2020', '--typeRoots', path.join(root, 'node_modules/@types'), path.join(consumer, 'tests/typescript-contract.ts')], consumer);
  for (const profile of profiles) {
    const stdout = command(profile.name, profile.node, ['--test', '--test-reporter=tap', ...tests.map(f => path.join(consumer, 'tests', f))], consumer);
    assert.equal(Number(stdout.match(/# tests (\d+)/)?.[1]), report.expectedTests); report.records.at(-1).tests = report.expectedTests;
  }
}
report.complete = true;
fs.writeFileSync(path.join(out, stage + '.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
