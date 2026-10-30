const assert = require('node:assert/strict');
const { test } = require('node:test');
const { AsyncLocalStorage } = require('node:async_hooks');
const dc = require('node:diagnostics_channel');
const http = require('node:http');
const snappy = require('snappy');
const protobuf = require('protobufjs');
const { LokiJsonTransport, LokiProtobufTransport } = require('../dist/infrastructure');
const { RetryGate, RetryAfterError, sendScope, RETRY_CODES } = require('../dist/infrastructure/transport/RetryPolicy');
const { LOKI_PROTO } = require('../dist/infrastructure/transport/proto/loki-proto');
const Push = protobuf.parse(LOKI_PROTO).root.lookupType('logproto.PushRequest');
const context = new AsyncLocalStorage();
const record = id => ({ id, timestamp: '2026-10-30T00:00:00.000Z', level: 'info', message: 'ordinary-' + id, context: { lane: id }, labels: { app: 'dispatch-fixture' } });
async function receiver(proto) {
  const rows = [], attempts = [];
  const server = http.createServer((req, res) => {
    const chunks = []; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > 65536) req.destroy(); else chunks.push(chunk); });
    req.on('end', () => {
      const bytes = Buffer.concat(chunks);
      const payload = proto ? Push.decode(snappy.uncompressSync(bytes)) : JSON.parse(bytes.toString());
      for (const stream of payload.streams) for (const item of proto ? stream.entries : stream.values) rows.push(JSON.parse(proto ? item.line : item[1]));
      res.writeHead(204); res.end();
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const channel = dc.channel('undici:request:create');
  const observe = ({ request }) => { if (String(request.origin) === origin) attempts.push({ at: performance.now(), tag: context.getStore() }); };
  channel.subscribe(observe);
  return { rows, attempts, url: origin + '/push', close: async () => { channel.unsubscribe(observe); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); } };
}

for (const proto of [false, true]) test(`public ${proto ? 'protobuf' : 'JSON'} dispatch checks a microtask-installed floor after codec prep, expires and preserves ordinary independent sends`, async () => {
  for (const duration of [60000, 40]) {
    const target = await receiver(proto);
    const config = { url: target.url, tenantId: 'synthetic', compression: proto ? 'snappy' : 'none', useWorkers: false, maxSockets: 2, timeout: duration === 60000 ? 150 : 1000, maxRetries: 0 };
    const Codec = proto ? LokiProtobufTransport : LokiJsonTransport;
    const transport = new Codec(config), independent = new Codec(config);
    const original = RetryGate.prototype.wait;
    const calls = new Map(); let gate, injected = false, floor = 0, releaseFloor;
    const floorObserved = new Promise(resolve => { releaseFloor = resolve; });
    // Instrument only the public wait method to schedule deterministic post-wait
    // policy observation. This is a post-fix control, not an unmocked race replay.
    RetryGate.prototype.wait = function (...args) {
      const pending = original.apply(this, args);
      const tag = context.getStore();
      if (tag === 'A' || tag === 'C') {
        if (gate === undefined) gate = this; else assert.equal(this, gate);
        const count = (calls.get(tag) ?? 0) + 1; calls.set(tag, count);
        if (tag === 'A' && count === 2 && !injected) {
          injected = true;
          queueMicrotask(() => { floor = performance.now() + duration; this.observe(new RetryAfterError(429, floor, false, false)); releaseFloor(); });
        }
        if (tag === 'C' && count === 2) {
          return pending.then(() => new Promise((resolve, reject) => {
            const signal = args[1];
            const cancel = () => { signal.removeEventListener('abort', cancel); reject(signal.reason); };
            signal.addEventListener('abort', cancel, { once: true });
            floorObserved.then(() => { signal.removeEventListener('abort', cancel); resolve(); });
            if (signal.aborted) cancel();
          }));
        }
      }
      return pending;
    };
    const inputs = [record('A'), record('C')], before = JSON.stringify(inputs);
    try {
      const results = await Promise.allSettled(inputs.map(input => context.run(input.id, () => transport.send([input]))));
      assert.equal(injected, true); assert.ok(calls.get('A') >= 2); assert.ok(calls.get('C') >= 2);
      assert.equal(JSON.stringify(inputs), before);
      if (duration === 60000) {
        for (const result of results) { assert.equal(result.status, 'rejected'); assert.equal(result.reason.message, RETRY_CODES.deadline); }
        assert.equal(target.attempts.length, 0); assert.equal(target.rows.length, 0);
        assert.equal(transport.getMetrics().totalSends, 2); assert.equal(transport.getMetrics().failedSends, 2);
        await independent.send([record('independent')]);
        assert.equal(target.rows[0].context.lane, 'independent'); assert.equal(target.attempts.length, 1);
      } else {
        assert.ok(results.every(r => r.status === 'fulfilled'));
        assert.equal(target.attempts.length, 2); assert.ok(target.attempts.every(r => r.at >= floor));
        assert.deepEqual(target.rows.map(r => r.context.lane).sort(), ['A', 'C']);
        for (const row of target.rows) { assert.equal(row.message, 'ordinary-' + row.context.lane); assert.equal(row.id, proto ? undefined : row.context.lane); }
        await transport.send([record('ordinary-after-expiry')]);
        assert.equal(target.rows.at(-1).context.lane, 'ordinary-after-expiry');
        assert.equal(transport.getMetrics().totalSends, 3); assert.equal(transport.getMetrics().successfulSends, 3); assert.equal(transport.getMetrics().failedSends, 0);
      }
    } finally { RetryGate.prototype.wait = original; await transport.destroy(); await independent.destroy(); await target.close(); }
  }
});

test('public RetryGate final dispatch check rejects newly cancelled, expired or degraded operations without invoking the closure', async () => {
  for (const mode of ['cancel', 'deadline', 'degraded']) {
    const gate = new RetryGate(), controller = new AbortController(), scope = sendScope(1000, [controller.signal]);
    let invoked = 0;
    const original = gate.wait.bind(gate);
    const deadline = mode === 'deadline' ? performance.now() - 1 : scope.deadline;
    gate.wait = (...args) => {
      const pending = mode === 'deadline' ? Promise.resolve() : original(...args);
      queueMicrotask(() => { if (mode === 'cancel') controller.abort(); if (mode === 'degraded') gate.observe(new RetryAfterError(429, 0, false, true)); });
      return pending;
    };
    try {
      await assert.rejects(gate.dispatch(deadline, scope.signal, async () => { invoked++; }), { message: mode === 'cancel' ? RETRY_CODES.cancelled : mode === 'deadline' ? RETRY_CODES.deadline : RETRY_CODES.huge });
      assert.equal(invoked, 0);
    } finally { scope.close(); gate.close(); }
  }
});
