'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const { spawn, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = path.resolve(process.argv[2]);
const use = createRequire(path.join(root, 'package.json'));
const entry = use.resolve('elven-logs-interceptor');
const pkg = use('elven-logs-interceptor/package.json');
const api = use('elven-logs-interceptor');
const results = [];
const deadline = setTimeout(() => { console.error('CONSUMER_DEADLINE'); process.exit(124); }, 20000);
const env = { PATH: process.env.PATH, HOME: root, TMPDIR: process.env.TMPDIR || '/tmp', LANG: 'C.UTF-8' };
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const stop = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
const config = url => ({ appName: 'clean-major-consumer', transport: { type: 'otlp', url, compression: 'none', timeout: 200, maxRetries: 0 }, buffer: { autoFlush: false } });
async function check(name, fn) { const start = performance.now(); const data = await fn(); results.push({ name, status: 'PASS', milliseconds: performance.now() - start, ...data }); }

(async () => {
  assert.equal(pkg.version, '2.0.1');
  await check('CJS and native ESM expose the existing public API', async () => {
    const esm = await import(pathToFileURL(entry));
    for (const name of ['init', 'getLogger', 'destroy', 'isInitialized', 'WinstonTransport', 'MorganAdapter', 'LogLevelVO']) {
      assert.equal(typeof api[name], 'function'); assert.equal(typeof esm[name], 'function');
    }
    assert.equal(esm.logger, api.logger);
    return { exports: Object.keys(api).sort() };
  });
  const bodies = [], headers = [];
  let mode = 'healthy', requests = 0;
  const server = http.createServer((req, res) => {
    requests++; headers.push(req.headers);
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      bodies.push(Buffer.concat(chunks));
      if (mode === 'slow') return;
      res.statusCode = mode === '429' ? 429 : 200;
      if (mode === '429') res.setHeader('retry-after', '0');
      res.end();
    });
  });
  await listen(server);
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await check('healthy collector, all privacy fields and real Winston stream completion', async () => {
      const input = Object.freeze({ nested: Object.freeze({ private_field: 'synthetic-private-key-value', value: 'PRIVATE_4201' }) });
      const labels = Object.freeze({ email: 'person@example.invalid', password: 'synthetic-static-password', custom: 'PRIVATE_4202' });
      const pattern = /private_field|PRIVATE_\d+/g; pattern.lastIndex = 17;
      const logger = api.init({ ...config(url), labels, dynamicLabels: { dynamic: () => 'PRIVATE_4203' }, filter: { sensitivePatterns: [/password/i, pattern] } });
      logger.info('ordinary direct call', input);
      logger.info('Ol\u00e1 \ud83d\ude00');
      logger.info('Bearer\u00a0synthetic-bearer-private');
      api.MorganAdapter.createStream(logger).write('PRIVATE_4205\n');
      const winston = use('winston');
      const transport = new api.WinstonTransport({ logger });
      const stream = winston.createLogger({ transports: [transport] });
      let callbacks = 0;
      await new Promise((resolve, reject) => {
        stream.once('error', reject); stream.once('finish', resolve);
        for (let i = 0; i < 12; i++) stream.write({ level: 'info', message: 'winston PRIVATE_4204' }, () => { callbacks++; });
        stream.end();
      });
      assert.equal(callbacks, 12);
      await logger.flush();
      const wire = Buffer.concat(bodies);
      for (const secret of ['synthetic-static-password', 'person@example.invalid', 'synthetic-private-key-value', 'synthetic-bearer-private', 'PRIVATE_4201', 'PRIVATE_4202', 'PRIVATE_4203', 'PRIVATE_4204', 'PRIVATE_4205']) assert.equal(wire.includes(Buffer.from(secret)), false);
      assert.equal(wire.includes(Buffer.from('ordinary direct call')), true);
      assert.equal(wire.includes(Buffer.from('Ol\u00e1 \ud83d\ude00')), true);
      assert.equal(input.nested.value, 'PRIVATE_4201'); assert.equal(pattern.lastIndex, 17);
      assert.equal(logger.getMetrics().logsProcessed, 16);
      await api.destroy();
      return { callbacks, wireBytes: wire.length };
    });
    await check('explicit OTLP destination retains documented ambient header merge; proxy env does not redirect', async () => {
      const before = requests;
      const childConfig = { ...config(url), transport: { ...config(url).transport, headers: { 'x-synthetic-owned': 'explicit-header' } } };
      const source = `const api=require(${JSON.stringify(entry)});const logger=api.init(${JSON.stringify(childConfig)});logger.info('header ownership control');logger.flush().then(()=>api.destroy()).then(()=>process.stdout.write('HEADER_OK')).catch(()=>process.exitCode=1);`;
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', source], { cwd: root, env: { ...env, HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', OTEL_EXPORTER_OTLP_HEADERS: 'x-synthetic-ambient=shared-header' }, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '', errors = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('HEADER_CHILD_DEADLINE')); }, 5000);
        child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); try { assert.equal(code, 0, errors); assert.equal(output, 'HEADER_OK'); resolve(); } catch (error) { reject(error); } });
      });
      assert.equal(requests - before, 1);
      assert.equal(headers[before]['x-synthetic-owned'], 'explicit-header');
      assert.equal(headers[before]['x-synthetic-ambient'], 'shared-header');
    });
    await check('shutdown and second-generation actual export, stable facade and retired owner fencing', async () => {
      const facade = api.logger, before = requests;
      const first = api.init(config(url)); first.info('generation-one'); await first.flush(); await first.destroy();
      assert.equal(api.isInitialized(), false);
      const second = api.init(config(url)); await first.destroy(); assert.equal(api.getLogger(), second);
      facade.info('generation-two'); await facade.flush(); await api.destroy();
      assert.equal(requests - before, 2);
      assert.ok(bodies.some(body => body.includes(Buffer.from('generation-two'))));
      return { actualExports: 2 };
    });
    await check('large input retains bounded wire and does not mutate caller buffers', async () => {
      const logger = api.init({ ...config(url), filter: { maxMessageLength: 65536, sensitivePatterns: [/password/i, /(a|aa)+b/] } });
      const buffer = Buffer.alloc(2_000_000);
      logger.info('b' + 'a'.repeat(65535), { payload: buffer, password: 'synthetic-large-password' });
      await logger.flush();
      const wire = bodies.at(-1); assert.ok(wire.length < 150000); assert.equal(buffer.length, 2_000_000);
      assert.equal(wire.includes(Buffer.from('synthetic-large-password')), false);
      await api.destroy(); return { wireBytes: wire.length, callerBufferBytes: buffer.length };
    });
    for (const failure of ['429', 'slow']) await check(`collector ${failure} settles within configured deadline`, async () => {
      mode = failure; const before = requests, logger = api.init(config(url)); logger.info('bounded failed export');
      await assert.rejects(logger.flush()); assert.equal(logger.getHealth().healthy, false); await api.destroy(); mode = 'healthy';
      assert.ok(requests - before <= 6); return { attempts: requests - before };
    });
    await check('NODE_OPTIONS preload: main/fork/cluster opt-in, automatic Worker skip, explicit Worker init', async () => {
      const preload = use.resolve('elven-logs-interceptor/preload.js');
      const source = `
        const assert=require('node:assert/strict'),{Worker}=require('node:worker_threads'),{fork}=require('node:child_process'),cluster=require('node:cluster');
        const entry=${JSON.stringify(entry)},api=require(entry);
        assert.equal(api.isInitialized(),true);
        const child=fork('-e',["const api=require("+JSON.stringify(entry)+");process.send({initialized:api.isInitialized()});api.destroy().then(()=>process.disconnect());"],{execArgv:[],silent:true});
        let forkReady=false,workerReady=false,clusterReady=false;
        const forkResult=new Promise((resolve,reject)=>{child.once('error',reject);child.once('message',m=>{assert.equal(m.initialized,true);forkReady=true;});child.once('exit',code=>code===0&&forkReady?resolve():reject(new Error('FORK_FAILED')));});
        const worker=new Worker("const assert=require('node:assert/strict'),{parentPort}=require('node:worker_threads');const api=require("+JSON.stringify(entry)+");assert.equal(api.isInitialized(),false);api.init("+JSON.stringify(${JSON.stringify(config(url))})+");assert.equal(api.isInitialized(),true);api.destroy().then(()=>parentPort.postMessage('ok'));",{eval:true});
        const workerResult=new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('message',m=>{assert.equal(m,'ok');workerReady=true;});worker.once('exit',code=>code===0&&workerReady?resolve():reject(new Error('WORKER_FAILED')));});
        cluster.setupPrimary({exec:'-e',args:["const assert=require('node:assert/strict'),cluster=require('node:cluster'),api=require("+JSON.stringify(entry)+");assert.equal(cluster.isWorker,true);process.send({initialized:api.isInitialized()});api.destroy().then(()=>process.disconnect());"],execArgv:[],silent:true});
        const clusterWorker=cluster.fork();
        const clusterResult=new Promise((resolve,reject)=>{clusterWorker.once('error',reject);clusterWorker.once('message',m=>{assert.equal(m.initialized,true);clusterReady=true;});clusterWorker.once('exit',code=>code===0&&clusterReady?resolve():reject(new Error('CLUSTER_FAILED')));});
        Promise.all([forkResult,workerResult,clusterResult]).then(()=>api.destroy()).then(()=>process.stdout.write('PRELOAD_OK')).catch(()=>process.exitCode=1);
      `;
      const child = spawnSync(process.execPath, ['-e', source], { cwd: root, encoding: 'utf8', timeout: 5000,
        env: { ...env, NODE_OPTIONS: '--require=' + preload, LOGS_TRANSPORT: 'otlp', LOGS_URL: url, LOGS_APP_NAME: 'child-preload', LOGS_BUFFER_AUTO_FLUSH: 'false' } });
      assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout, 'PRELOAD_OK');
    });
  } finally { await api.destroy(); await stop(server); }
  await check('offline collector rejects without an unbounded retry or shutdown', async () => {
    const offline = http.createServer(); await listen(offline); const port = offline.address().port; await stop(offline);
    const logger = api.init(config(`http://127.0.0.1:${port}`)); logger.info('offline'); await assert.rejects(logger.flush()); await api.destroy();
  });
  process.stdout.write(JSON.stringify({ node: process.version, packageVersion: pkg.version, results, status: 'PASS' }) + '\n');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(deadline));
