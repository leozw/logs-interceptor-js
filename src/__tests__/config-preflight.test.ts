import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import * as api from '../index';
import { ConfigService } from '../application/services/ConfigService';
import { configSnapshot } from '../application/config/ConfigSnapshot';
import { MemoryDeadLetterQueue } from '../infrastructure/dlq/MemoryDeadLetterQueue';
import { mergeConfigs, parseBool } from '../utils';

test('actual public init rejects config accessors/budgets before merge and preserves the healthy logger', async () => {
  const { runPublicConfigGate } = createRequire(join(process.cwd(), 'package.json'))('./test-support/config-preflight.cjs') as {
    runPublicConfigGate(value: typeof api): Promise<{ getterCalls: number; rejected: number }>;
  };
  const result = await runPublicConfigGate(api); assert.equal(result.getterCalls, 0); assert.equal(result.rejected, 8);
});

test('direct merge/validation boundaries reject accessors before reading values and keep normal function identity', () => {
  let invoked = 0;
  const input = Object.defineProperty({}, 'transport', { enumerable: true, get() { invoked++; return { url: 'http://127.0.0.1:9' }; } });
  assert.throws(() => mergeConfigs(input, {}), { message: 'ELVEN_CONFIG_INPUT_BUDGET' });
  assert.throws(() => mergeConfigs({}, input), { message: 'ELVEN_CONFIG_INPUT_BUDGET' });
  assert.throws(() => ConfigService.validate(input), { message: 'ELVEN_CONFIG_INPUT_BUDGET' });
  assert.equal(invoked, 0);
  const provider = () => 'ordinary'; const config = { appName: 'normal', dynamicLabels: { provider } };
  assert.equal(configSnapshot(config).dynamicLabels.provider, provider);
  assert.equal(mergeConfigs(config, {}).dynamicLabels?.provider, provider);
  assert.equal(parseBool('unsupported', true), true); assert.equal(parseBool('false', true), false);
});

test('direct memory DLQ constructor rejects invalid capacity without weakening valid range/default behavior', async () => {
  for (const invalid of [NaN, Infinity, -Infinity, 0, -1, 1.5, 10000.1, 10001, '10', null]) {
    assert.throws(() => new MemoryDeadLetterQueue(invalid as number), { message: 'ELVEN_DLQ_CAPACITY_BUDGET' });
  }
  const entry = { id: 'ordinary', level: 'info' as const, timestamp: new Date().toISOString(), message: 'ordinary' };
  for (const [capacity, count, expected] of [[undefined, 1001, 1000], [1, 2, 1], [1000, 1001, 1000], [10000, 10001, 10000]] as const) {
    const queue = new MemoryDeadLetterQueue(capacity);
    const result = await queue.addBatch(Array.from({ length: count }, () => entry), 'test');
    assert.equal(queue.size(), expected); assert.equal(result.dropped, count - expected);
    assert.equal(queue.getStats().droppedEntries, count - expected); await queue.clear(); assert.equal(queue.size(), 0);
  }
});
