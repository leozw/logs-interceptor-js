const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const path = require('node:path');
const zlib = require('node:zlib');
const { WorkerPool } = require('../dist/infrastructure/workers/WorkerPool');
const { safeStringify, sanitizeData } = require('../dist/utils');
const { MemoryBuffer } = require('../dist/infrastructure/buffer/MemoryBuffer');
const { ConfigService } = require('../dist/application/services/ConfigService');
const api = require('../dist');

test('legacy graph handling is bounded, detached, and does not invoke ordinary getters/toJSON', () => {
  let called = 0;
  const value = { payload: Buffer.alloc(1024 * 1024), token: 'private-value', toJSON() { called++; return 'unsafe'; } };
  Object.defineProperty(value, 'getter', { enumerable:true, get() { called++; return 'unsafe'; } });
  value.self = value;
  const text = safeStringify(value);
  assert.ok(text.length < 2000);
  assert.equal(called, 0);
  const clean = sanitizeData(value, [/token/g]);
  assert.equal(clean.token, '[REDACTED]');
  assert.equal(sanitizeData({ token:'again' }, [/token/g]).token, '[REDACTED]');
  assert.equal(called, 0);
  assert.ok(ConfigService.validate({filter:{patterns:[/^(a+)+$/]}}).some(error=>error.includes('safe regular')));
});

test('legacy buffer hard count/memory limits apply even when auto flush is disabled', () => {
  const buffer = new MemoryBuffer({maxSize:3,maxMemoryMB:1,flushInterval:1000,maxAge:30000,autoFlush:false});
  for(let i=0;i<1000;i++)buffer.add({id:String(i),level:'info',timestamp:new Date().toISOString(),message:'x',context:{nested:{data:'x'.repeat(2000)}}});
  assert.ok(buffer.size()<=3);
  assert.ok(buffer.getMetrics().memoryUsageMB<=1);
  buffer.clear();
  const timed = new MemoryBuffer({maxSize:3,maxMemoryMB:1,flushInterval:1000,maxAge:30000,autoFlush:true});
  assert.equal(timed.flushTimer.hasRef(),false);
  timed.clear();
});

test('legacy Worker saturation, clone failure, timeout and destroy settle tasks', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'legacy-worker-'));
  const script = path.join(dir,'idle.cjs');
  fs.writeFileSync(script, "require('node:worker_threads').parentPort.on('message',()=>{});");
  const pool = new WorkerPool({maxWorkers:1,maxQueueSize:1,taskTimeout:100,workerScript:script});
  const a=pool.execute('process',{}), b=pool.execute('process',{});
  const settled=Promise.allSettled([a,b]);
  await assert.rejects(pool.execute('process',{}),/queue limit/);
  await pool.destroy();
  assert.ok((await settled).every(result=>result.status==='rejected'));
  const timeout = new WorkerPool({maxWorkers:1,taskTimeout:50,workerScript:script});
  await assert.rejects(timeout.execute('process',{}),/timeout|exited/);
  await timeout.destroy();
  const real = new WorkerPool({maxWorkers:1});
  await assert.rejects(real.execute('process',()=>{}));
  assert.deepEqual(await real.execute('process',[]),[]);
  await real.destroy();
  fs.rmSync(dir,{recursive:true});
});

test('legacy public API exports valid Loki none/gzip/Brotli/Snappy with and without Workers', async () => {
  const requests=[];
  const server=http.createServer((req,res)=>{
    const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{requests.push({headers:req.headers,body:Buffer.concat(chunks)});res.writeHead(204);res.end();});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    for(const compression of ['none','gzip','brotli','snappy'])for(const useWorkers of [false,true])for(const count of [1,60]) {
      const requestCount=requests.length;
      const logger=api.init({appName:'legacy-api',transport:{url:`http://127.0.0.1:${server.address().port}/loki/api/v1/push`,tenantId:'tenant',compression,useWorkers,maxWorkers:1,maxRetries:0,timeout:500},buffer:{autoFlush:false,maxSize:100},filter:{sanitize:true},dynamicLabels:{request_id:()=>String(Math.random())},enableMetrics:false});
      const original={password:'private-value',data:Buffer.alloc(65536)};
      for(let i=0;i<count;i++)logger.info('legacy-plain',original);
      await logger.flush();
      await api.destroy();
      assert.equal(requests.length,requestCount+1);
      assert.equal(original.password,'private-value');
      const request=requests.at(-1);
      let body=request.body;
      if(request.headers['content-encoding']==='gzip')body=zlib.gunzipSync(body);
      if(request.headers['content-encoding']==='br')body=zlib.brotliDecompressSync(body);
      if(request.headers['content-encoding']==='snappy') {
        body=await require('snappy').uncompress(body);
        const protobuf=require('protobufjs');
        const root=protobuf.parse(require('../dist/infrastructure/transport/proto/loki-proto').LOKI_PROTO).root;
        const decoded=root.lookupType('logproto.PushRequest').decode(body);
        assert.equal(decoded.streams.length,1);
        assert.equal(decoded.streams[0].entries.length,count);
        assert.equal(JSON.stringify(decoded).includes('private-value'),false);
      } else {
        const decoded=JSON.parse(body);
        assert.equal(decoded.streams.length,1);
        assert.equal(decoded.streams[0].values.length,count);
        assert.equal(JSON.stringify(decoded).includes('private-value'),false);
      }
      assert.ok(body.toString().includes('legacy-plain'));
      assert.equal(api.isInitialized(),false);
    }
  } finally {await api.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('legacy whole wire applies static label policy without changing originals or sanitize:false', async () => {
  const requests=[];
  const server=http.createServer((req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{requests.push(Buffer.concat(chunks));res.writeHead(204);res.end();});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const labels=Object.freeze({password:'legacy-static-password',email:'legacy-static-user@example.test',organization:'legacy-static-organization'});
  try {
    for(const mode of ['default','custom','disabled']) {
      const filter=mode==='custom'?{sensitivePatterns:[/organization/i]}:mode==='disabled'?{sanitize:false}:{};
      const logger=api.init({appName:'static-privacy',labels,transport:{url:`http://127.0.0.1:${server.address().port}/push`,tenantId:'tenant',compression:'none',useWorkers:false,maxRetries:0},buffer:{autoFlush:false},filter});
      logger.info('static-labels');await logger.flush();await api.destroy();
      const body=requests.at(-1).toString();
      const decoded=JSON.parse(body);
      if(mode==='default') {
        assert.equal(body.includes(labels.password),false);
        assert.equal(body.includes(labels.email),false);
        assert.equal(decoded.streams[0].stream.password,'[REDACTED]');
      } else if(mode==='custom') assert.equal(body.includes(labels.organization),false);
      else for(const value of Object.values(labels))assert.ok(body.includes(value));
      for(const value of Object.values(decoded.streams[0].stream))assert.equal(typeof value,'string');
    }
    assert.deepEqual(labels,{password:'legacy-static-password',email:'legacy-static-user@example.test',organization:'legacy-static-organization'});
    assert.equal(requests.length,3);
  } finally {await api.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('legacy public zero-retry export attempts once; 429/trickle/large responses terminate', async () => {
  for(const mode of ['429','trickle','large']) {
    let requests=0;
    const server=http.createServer((req,res)=>{requests++;req.resume();req.on('end',()=>{
      if(mode==='429'){res.writeHead(429);res.end('private-server-response');}
      else if(mode==='large')res.end(Buffer.alloc(100000));
      else {res.writeHead(503);const timer=setInterval(()=>res.write('x'),10);res.on('close',()=>clearInterval(timer));}
    });});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const logger=api.init({appName:'failure',transport:{url:`http://127.0.0.1:${server.address().port}/push`,tenantId:'tenant',useWorkers:false,compression:'none',maxRetries:0,timeout:100},buffer:{autoFlush:false},deadLetterQueue:{enabled:false}});
      logger.info('failure');
      const started=Date.now();
      await assert.rejects(logger.flush(),error=>!error.message.includes('private-server-response'));
      assert.ok(Date.now()-started<3000);
      assert.equal(requests,1);
      await api.destroy();
    } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  }
});

test('legacy console ownership is restored on destroy and preserves newer application hooks', async () => {
  const original=console.info;
  const logger=api.init({appName:'console',transport:{url:'http://127.0.0.1:9/push',tenantId:'tenant',useWorkers:false,maxRetries:0,timeout:50},buffer:{autoFlush:false},interceptConsole:true,preserveOriginalConsole:false});
  await api.destroy();
  assert.equal(console.info,original);
  const replacement=()=>{};
  api.init({appName:'console',transport:{url:'http://127.0.0.1:9/push',tenantId:'tenant',useWorkers:false,maxRetries:0,timeout:50},buffer:{autoFlush:false},interceptConsole:true,preserveOriginalConsole:false});
  console.info=replacement;
  await api.destroy();
  assert.equal(console.info,replacement);
  console.info=original;
  assert.equal(typeof logger.trackEvent,'function');
});

test('legacy zero-retry offline delivery rejects and retry backoff is cancellable', async () => {
  const {ResilientTransport}=require('../dist/infrastructure/transport/ResilientTransport');
  let attempts=0;
  const transport=new ResilientTransport({send:async()=>{attempts++;throw Object.assign(new Error('offline'),{code:'ECONNREFUSED'});},destroy:async()=>{}},{maxRetries:20,retryDelay:30000});
  const pending=transport.send([{}]);
  const rejected=assert.rejects(pending,/closed/);
  await new Promise(resolve=>setTimeout(resolve,10));
  await transport.destroy();
  await rejected;
  assert.equal(attempts,1);
  const logger=api.init({appName:'offline',transport:{url:'http://127.0.0.1:9/push',tenantId:'tenant',useWorkers:false,maxRetries:0,timeout:50},buffer:{autoFlush:false}});
  logger.info('offline');
  await assert.rejects(logger.flush());
  await api.destroy();
});

test('legacy file DLQ bounds disk use and creates private new storage', async () => {
  const fs=require('node:fs'),os=require('node:os');
  const {FileDeadLetterQueue}=require('../dist/infrastructure/dlq/FileDeadLetterQueue');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-dlq-'));
  try {
    const dlq=new FileDeadLetterQueue({basePath:dir,maxSize:2,maxFileSizeMB:0.001});
    const entry={id:'1',level:'info',timestamp:new Date().toISOString(),message:'small'};
    await dlq.add(entry,'test');
    const folder=path.join(dir,'.logs-interceptor-dlq');
    const file=path.join(folder,fs.readdirSync(folder)[0]);
    assert.equal(fs.statSync(folder).mode&0o077,0);
    assert.equal(fs.statSync(file).mode&0o077,0);
    await dlq.add({...entry,message:'x'.repeat(10000)},'large');
    assert.ok(fs.statSync(file).size<=1024*1024*0.001);
    assert.ok(dlq.size()<=2);
  } finally {fs.rmSync(dir,{recursive:true});}
});

test('legacy Node-RED passes messages through failed logging and snapshots payloads', () => {
  const original=api.init;
  let Constructor;
  const handlers={};
  let sent=0,accessors=0;
  api.init=()=>({info:()=>{throw new Error('logging failed');},destroy:async()=>{}});
  try {
    require('../dist/presentation/node-red/logs-interceptor-node')({nodes:{registerType:(_name,fn)=>{Constructor=fn;},createNode:node=>Object.assign(node,{on:(name,fn)=>{handlers[name]=fn;},send:()=>{sent++;},status:()=>{},log:()=>{},warn:()=>{},error:()=>{}})},httpAdmin:{get:()=>{}}});
    new Constructor({url:'http://127.0.0.1:9',tenantId:'tenant',appName:'node-red'});
    const payload={buffer:Buffer.alloc(100000)};
    Object.defineProperty(payload,'getter',{enumerable:true,get(){accessors++;return 'secret';}});
    handlers.input({payload});
    assert.equal(sent,1);assert.equal(accessors,0);
  } finally {api.init=original;}
});

test('legacy Winston callback follows logged event instead of building an immediate backlog', async () => {
  const {WinstonTransport}=require('../dist/infrastructure/integrations/WinstonTransport');
  const transport=new WinstonTransport({logger:{info:()=>{}}});
  const events=[];
  transport.on('logged',()=>events.push('logged'));
  const done=new Promise(resolve=>transport.log({level:'info',message:'message'},()=>{events.push('callback');resolve();}));
  assert.deepEqual(events,[]);
  await done;
  assert.deepEqual(events,['logged','callback']);
  transport.close?.();
});

test('legacy NODE_OPTIONS keeps old environment, skips Workers and preserves signal ownership', () => {
  const {spawnSync}=require('node:child_process');
  const modulePath=require.resolve('../dist');
  const preload=require.resolve('../preload.js');
  const env={...process.env,NODE_OPTIONS:`--require ${preload}`,LOGS_INTERCEPTOR_URL:'http://127.0.0.1:9/push',LOGS_INTERCEPTOR_TENANT_ID:'tenant',LOGS_INTERCEPTOR_APP_NAME:'preload',LOGS_INTERCEPTOR_TIMEOUT:'50',LOGS_INTERCEPTOR_MAX_RETRIES:'0',LOGS_INTERCEPTOR_SAMPLING_RATE:'0',LOGS_INTERCEPTOR_INTERCEPT_CONSOLE:'false',LOGS_INTERCEPTOR_SILENT_ERRORS:'true'};
  const lifecycle=spawnSync(process.execPath,['-e',`
    const api=require(${JSON.stringify(modulePath)});const{Worker}=require('node:worker_threads');
    const worker=new Worker('const{parentPort}=require("node:worker_threads");parentPort.postMessage(require('+JSON.stringify(${JSON.stringify(modulePath)})+').isInitialized());',{eval:true});
    worker.on('message',async active=>{console.log('lifecycle:'+api.isInitialized()+':'+active);await api.destroy();await worker.terminate();});
  `],{encoding:'utf8',env,timeout:5000});
  assert.equal(lifecycle.status,0,lifecycle.stderr);
  assert.match(lifecycle.stdout,/lifecycle:true:false/);
  const normal=spawnSync(process.execPath,['-e',`require('node:http').createServer().listen(0);setTimeout(()=>process.kill(process.pid,'SIGTERM'),50);`],{env,timeout:5000});
  assert.equal(normal.signal,'SIGTERM');
  for (const method of ['on','once']) {
    const owned=spawnSync(process.execPath,['-e',`process.${method}('SIGTERM',()=>setTimeout(()=>process.exit(23),50));require('node:http').createServer().listen(0);setTimeout(()=>process.kill(process.pid,'SIGTERM'),50);`],{env,timeout:5000});
    assert.equal(owned.status,23);
  }
});
