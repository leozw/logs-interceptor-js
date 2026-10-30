'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const repo = path.resolve(__dirname, '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'elven-major-consumer-'));
const consumer = path.join(home, 'consumer'), artifacts = path.join(home, 'artifacts'), fixture = path.join(home, 'synthetic-tls');
for (const dir of [consumer, artifacts, fixture]) fs.mkdirSync(dir);
for (const name of ['user.npmrc', 'global.npmrc']) fs.writeFileSync(path.join(home, name), '# deliberately empty anonymous configuration\n');
const env = { PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH, HOME: home, TMPDIR: home, LANG: 'C.UTF-8',
  NPM_CONFIG_USERCONFIG: path.join(home, 'user.npmrc'), NPM_CONFIG_GLOBALCONFIG: path.join(home, 'global.npmrc'),
  NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/', NPM_CONFIG_CACHE: path.join(home, 'npm-cache'), NPM_CONFIG_UPDATE_NOTIFIER: 'false' };
const rows = [];
function run(name, command, args, cwd = repo, extra = {}) {
  if (command === 'npm' && fs.existsSync(path.join(cwd, '.npmrc'))) throw new Error('Refusing project npmrc');
  const result = spawnSync(command, args, { cwd, env: { ...env, ...extra }, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  rows.push({ name, status: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr });
  if (result.status !== 0) throw new Error('Consumer gate failed: ' + name + '\n' + result.stderr + '\n' + result.stdout);
  return result.stdout;
}
try {
  const supplied = process.argv[2];
  let archive;
  if (supplied) archive = path.resolve(supplied);
  else {
    const packs = JSON.parse(run('pack', 'npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', artifacts]));
    if (packs.length !== 1 || packs[0].version !== '2.0.1' || !packs[0].files.some(file => file.path === 'dist/infrastructure/privacy/matcher-core.cjs')) throw new Error('Missing exact candidate/runtime core');
    archive = path.join(artifacts, packs[0].filename);
  }
  fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ private: true, name: 'isolated-elven-major-consumer', version: '0.0.0', dependencies: { 'elven-logs-interceptor': 'file:' + archive, winston: '3.19.0' } }));
  const offlineAt = process.argv.indexOf('--offline-feed');
  if (offlineAt >= 0) {
    const feed = process.argv[offlineAt + 1];
    if (!feed || !path.isAbsolute(feed) || !fs.statSync(feed).isDirectory()) throw new Error('Explicit offline dependency feed required');
    fs.cpSync(feed, path.join(consumer, 'node_modules'), { recursive: true });
    const installed = path.join(consumer, 'node_modules/elven-logs-interceptor');
    fs.rmSync(installed, { recursive: true, force: true }); fs.mkdirSync(installed);
    run('extract exact candidate into independent offline consumer', '/usr/bin/tar', ['-xf', archive, '--strip-components=1', '-C', installed]);
    rows.push({ name: 'fresh registry dependency audit', status: 'NOT_RUN_OFFLINE', reason: 'Functional replay only; no fresh advisory/graph claim.' });
  } else {
    run('anonymous install', 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
    run('production dependency audit', 'npm', ['audit', '--omit=dev', '--json'], consumer);
  }
  const contract = `import pkg, { init, destroy, logger, WinstonTransport, type ILogger, type LogsInterceptorConfig } from 'elven-logs-interceptor';
const config:Partial<LogsInterceptorConfig>={appName:'typed',transport:{type:'otlp',url:'http://127.0.0.1:9'},filter:{sensitivePatterns:[/private/i]}};
const handle:ILogger=init(config);const codes:readonly string[]|undefined=handle.getHealth().privacyDiagnostics;
const transport=new WinstonTransport({logger:handle});logger.withContext({id:1},()=>codes);void pkg.init;void transport;void destroy();`;
  for (const extension of ['cts', 'mts']) fs.writeFileSync(path.join(consumer, 'contract.' + extension), contract);
  run('strict typed CJS and ESM', process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--types', 'node', '--typeRoots', path.join(repo, 'node_modules/@types'), path.join(consumer, 'contract.cts'), path.join(consumer, 'contract.mts')]);
  run('production runtime', process.execPath, [path.join(__dirname, 'consumer-runtime.cjs'), consumer]);
  run('native and generic malformed UTF-16 six-site whole-wire privacy', process.execPath, [path.join(__dirname, 'native-unicode-consumer.cjs'), consumer]);
  run('actual packed queue and native matcher backing-store ownership', process.execPath, [path.join(__dirname, 'retainer-consumer.cjs'), consumer]);
  run('Loki JSON/protobuf, all codecs and actual Workers', process.execPath, [path.join(__dirname, 'loki-consumer.cjs'), consumer]);
  run('Loki Retry-After floors, cross-send declines, date and malformed-field recovery with all codecs and Workers', process.execPath, [path.join(__dirname, 'retry-after-consumer.cjs'), path.join(consumer, 'node_modules/elven-logs-interceptor')]);
  run('exact v3 public Brotli preparation race, post-preparation decline and explicit unacknowledged-entry accounting', process.execPath, [path.join(__dirname, 'preparation-floor-consumer.cjs'), path.join(consumer, 'node_modules/elven-logs-interceptor')]);
  run('generate synthetic TLS fixture', 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(fixture, 'key.pem'), '-out', path.join(fixture, 'cert.pem'), '-subj', '/CN=localhost', '-days', '1', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1']);
  fs.chmodSync(path.join(fixture, 'key.pem'), 0o600);
  run('reject untrusted TLS', process.execPath, [path.join(__dirname, 'tls-consumer.cjs'), consumer, fixture, 'untrusted']);
  run('trust explicit synthetic CA and export privately', process.execPath, [path.join(__dirname, 'tls-consumer.cjs'), consumer, fixture, 'trusted'], repo, { NODE_EXTRA_CA_CERTS: path.join(fixture, 'cert.pem') });
  process.stdout.write(JSON.stringify({ status: offlineAt >= 0 ? 'FUNCTIONAL_PASS_FRESH_AUDIT_PENDING' : 'PASS', node: process.version, archiveSha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), rows }) + '\n');
} catch (error) { console.error(error); process.exitCode = 1; }
finally { fs.rmSync(home, { recursive: true, force: true }); }
