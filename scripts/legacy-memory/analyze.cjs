'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const run = fs.realpathSync(process.argv[2]);
assert.equal(path.dirname(run), fs.realpathSync(path.join(__dirname, '../../.rebuild/legacy-detachment-qualification/gc')));
const controller = JSON.parse(fs.readFileSync(path.join(run, 'controller.json')));
assert.equal(controller.complete, true); assert.equal(controller.inputsUnchanged, true);
const result = [];
for (const item of controller.results) {
  const receipt = JSON.parse(fs.readFileSync(path.join(run, item.name + '.json')));
  const heap = JSON.parse(fs.readFileSync(receipt.snapshot));
  const nf = heap.snapshot.meta.node_fields, ef = heap.snapshot.meta.edge_fields;
  const ns = nf.length, es = ef.length, count = heap.nodes.length / ns;
  const ni = Object.fromEntries(nf.map((name, n) => [name, n])), ei = Object.fromEntries(ef.map((name, n) => [name, n]));
  const types = heap.snapshot.meta.node_types[ni.type], edgeTypes = heap.snapshot.meta.edge_types[ei.type];
  const start = new Uint32Array(count + 1);
  for (let n = 0; n < count; n++) start[n + 1] = start[n] + heap.nodes[n * ns + ni.edge_count] * es;
  const info = n => ({ index: n, id: heap.nodes[n * ns + ni.id], type: types[heap.nodes[n * ns + ni.type]], name: heap.strings[heap.nodes[n * ns + ni.name]], selfBytes: heap.nodes[n * ns + ni.self_size] });
  function edges(n) {
    const values = [];
    for (let offset = start[n]; offset < start[n + 1]; offset += es) {
      const type = edgeTypes[heap.edges[offset + ei.type]], value = heap.edges[offset + ei.name_or_index];
      if (type === 'weak') continue;
      const name = type === 'element' || type === 'hidden' ? String(value) : heap.strings[value];
      values.push({ type, name, to: heap.edges[offset + ei.to_node] / ns });
    }
    return values;
  }
  const parents = new Map(), buffers = [], services = [], callers = [];
  for (let n = 0; n < count; n++) {
    const node = info(n);
    if (node.type === 'object' && node.name === 'MemoryBuffer') buffers.push(n);
    if (node.type === 'object' && node.name === 'LogService') services.push(n);
    if (node.type === 'object' && node.name.startsWith('global') && edges(n).some(edge => edge.name === '__legacyCallerHold')) callers.push(n);
    if (node.type !== 'string' || !['facadea0', 'facadeb1', 'facadec2', 'facaded3'].some(prefix => node.name.startsWith(prefix))) continue;
    const map = edges(n).find(edge => edge.name === 'map'); const mapName = map ? info(map.to).name : '';
    if (node.selfBytes >= 512 * 1024 || (node.name.length === 1024 && mapName.includes('ExternalOneByteString'))) parents.set(n, { id: node.id, prefix: node.name.slice(0, 8), heapSelfBytes: node.selfBytes, sampleUnits: node.name.length, mapName });
  }
  function walk(roots, field) {
    const witnesses = new Map();
    const pending = [];
    for (const n of roots) for (const edge of edges(n)) if (edge.name === field) pending.push({ node: edge.to, chain: [{ owner: info(n).name, type: edge.type, edge: edge.name }] });
    const seen = new Set();
    for (let cursor = 0; cursor < pending.length && cursor < 8192; cursor++) {
      const { node, chain } = pending[cursor]; if (seen.has(node)) continue; seen.add(node);
      if (parents.has(node)) { witnesses.set(node, chain); continue; }
      if (chain.length >= 10) continue;
      const current = info(node);
      for (const edge of edges(node)) {
        if (edge.name === '__proto__' || edge.name === 'map') continue;
        const allowed = current.type === 'sliced string' || current.type === 'concatenated string'
          ? ['parent', 'first', 'second', 'actual'].includes(edge.name)
          : current.type === 'array' ? edge.type === 'element' || /^\d+$/.test(edge.name)
            : current.type === 'object' ? edge.type === 'element' || edge.type === 'property' || edge.name === 'elements' : false;
        if (allowed) pending.push({ node: edge.to, chain: [...chain, { owner: current.type === 'object' ? current.name : current.type, type: edge.type, edge: edge.name }] });
      }
    }
    return witnesses;
  }
  const queued = walk(buffers, 'entries'), configured = walk(services, 'config'), caller = walk(callers, '__legacyCallerHold');
  result.push({ name: item.name, queued: receipt.queued, drops: receipt.drops, externalDelta: receipt.externalDelta, wireRecords: receipt.decodedWireRecords, noForcedRegExpRootClearing: receipt.noForcedRegExpRootClearing, largeParents: parents.size, queuedParents: queued.size, configParents: configured.size, callerParents: caller.size, parents: [...parents].map(([node, value]) => ({ ...value, queuePath: queued.get(node) || null, configPath: configured.get(node) || null, callerPath: caller.get(node) || null })) });
}
for (const row of result) {
  assert.equal(row.queuedParents, 0, row.name + ': queued large backing parent');
  assert.equal(row.configParents, 0, row.name + ': configured large backing parent');
  assert.equal(row.largeParents, row.name === 'caller-control' ? 4 : 0, row.name + ': unclassified large parent');
  assert.equal(row.callerParents, row.name === 'caller-control' ? 4 : 0, row.name + ': caller control');
}
const output = { at: new Date().toISOString(), source: controller.source, archiveSha256: controller.archiveSha256, nodeSha256: controller.nodeSha256, beforeFeedSha256: controller.beforeFeedSha256, afterFeedSha256: controller.afterFeedSha256, results: result, scope: 'Own legacy3 exact candidate only. Nonweak MemoryBuffer/config paths plus synthetic controlled allocation; 32-byte external headers are not backing size. No forced RegExp-root clearing, no SDK/modern/public2.x/customer extrapolation. Other roots not exhaustively classified.' };
fs.writeFileSync(path.join(run, 'retainers.json'), JSON.stringify(output, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ run, results: result.map(({ parents, ...row }) => row) }, null, 2));
