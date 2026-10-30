'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const [artifactFile, profile, node] = process.argv.slice(2);
assert.ok(artifactFile && /^(minimum22|22|24|26)$/.test(profile) && path.isAbsolute(node));
const artifact = JSON.parse(fs.readFileSync(artifactFile)); assert.equal(artifact.complete, true);
assert.equal(artifact.freshInstall, false);
const out = path.join(root, '.rebuild/legacy-detachment-qualification/gc');
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
const run = fs.mkdtempSync(path.join(out, profile + '-')); fs.chmodSync(run, 0o700);
fs.mkdirSync(path.join(run, 'home'), { mode: 0o700 });
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
function inventory(dir) {
  const rows = [];
  function visit(rel) {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      const file = path.join(rel, name), full = path.join(dir, file), stat = fs.lstatSync(full);
      if (stat.isDirectory()) visit(file);
      else if (stat.isSymbolicLink()) { assert.ok(fs.realpathSync(full).startsWith(dir + path.sep)); rows.push({ file, link: fs.readlinkSync(full) }); }
      else { assert.ok(stat.isFile()); rows.push({ file, bytes: stat.size, sha256: sha(fs.readFileSync(full)) }); }
    }
  }
  visit(''); return rows;
}
const archive = path.join(root, 'release/3.0.0', artifact.source, 'logs-interceptor-3.0.0.tgz');
assert.equal(sha(fs.readFileSync(archive)), artifact.archiveSha256);
const before = inventory(path.join(artifact.consumer, 'node_modules'));
const report = { at: new Date().toISOString(), source: artifact.source, archiveSha256: artifact.archiveSha256, consumer: artifact.consumer, run, profile, node, nodeSha256: sha(fs.readFileSync(node)), beforeFeedSha256: sha(JSON.stringify(before)), feedEntries: before.length, artifactReportSha256: sha(fs.readFileSync(artifactFile)), limits: { largeInputMiB: 4, oldSpaceMiB: 128, perFileMiB: 64, watchdogMs: 25000 }, mode: 'Own legacy3 actual installed publicAPI GC/retainer/wire controls; no forced native RegExp-root clearing, no registry/install/Docker. Not whole-process RSS or customer OOM proof.', results: [] };
report.harness = Object.fromEntries(['qualify.cjs', 'probe.cjs', 'analyze.cjs'].map(file => { const bytes = fs.readFileSync(path.join(__dirname, file)); fs.writeFileSync(path.join(run, file), bytes, { mode: 0o600 }); return [file, sha(bytes)]; }));
fs.writeFileSync(path.join(run, 'feed-manifest.json'), JSON.stringify(before), { mode: 0o600 });
const names = ['default-short', 'default-full', 'default-views', 'generic-short', 'generic-full', 'generic-views', 'disabled-views', 'ids-views', 'dynamic-views', 'static-views', 'identity-views', 'caller-control', 'context-views', 'generic-context-views', 'disabled-full'];
const wrapper = 'import os,resource,sys\nresource.setrlimit(resource.RLIMIT_CORE,(0,0))\nresource.setrlimit(resource.RLIMIT_FSIZE,(67108864,67108864))\nos.execv(sys.argv[1],sys.argv[1:])';
try {
  for (const name of names) {
    const child = spawnSync('/usr/bin/python3', ['-c', wrapper, node, '--expose-gc', '--max-old-space-size=128', path.join(__dirname, 'probe.cjs'), name, run, artifact.consumer], { cwd: run, env: { PATH: '/usr/bin:/bin', HOME: path.join(run, 'home') }, encoding: 'utf8', timeout: 25000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 });
    fs.writeFileSync(path.join(run, name + '.stdout.log'), child.stdout || '', { mode: 0o600 });
    fs.writeFileSync(path.join(run, name + '.stderr.log'), child.stderr || '', { mode: 0o600 });
    report.results.push({ name, status: child.status, signal: child.signal, errorCode: child.error?.code, complete: fs.existsSync(path.join(run, name + '.json')) });
    fs.writeFileSync(path.join(run, 'controller.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    assert.equal(child.status, 0, name + ': see ' + run); assert.equal(report.results.at(-1).complete, true);
  }
} finally {
  report.afterFeedSha256 = sha(JSON.stringify(inventory(path.join(artifact.consumer, 'node_modules'))));
  report.inputsUnchanged = report.beforeFeedSha256 === report.afterFeedSha256 && report.archiveSha256 === sha(fs.readFileSync(archive)) && report.nodeSha256 === sha(fs.readFileSync(node));
  report.harnessUnchanged = Object.entries(report.harness).every(([file, digest]) => sha(fs.readFileSync(path.join(__dirname, file))) === digest);
  report.complete = report.results.length === names.length && report.results.every(v => v.status === 0 && v.complete);
  fs.writeFileSync(path.join(run, 'controller.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
}
assert.equal(report.inputsUnchanged, true); assert.equal(report.harnessUnchanged, true); assert.equal(report.complete, true);
const analyzed = spawnSync(node, ['--max-old-space-size=512', path.join(__dirname, 'analyze.cjs'), run], { cwd: run, env: { PATH: '/usr/bin:/bin', HOME: path.join(run, 'home') }, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
fs.writeFileSync(path.join(run, 'analysis.log'), (analyzed.stdout || '') + (analyzed.stderr || ''), { mode: 0o600 }); assert.equal(analyzed.status, 0, 'Heap analysis: see ' + run);
console.log(JSON.stringify({ run, profile, source: report.source, archiveSha256: report.archiveSha256, cases: names.length, inputsUnchanged: true, analysis: 'PASS; caller positive control retained, no large parents in other14 cases' }));
