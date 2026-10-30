import assert from 'node:assert/strict';
import { lessThan } from '../../test-support/assertions';
import { describe, it, mock } from 'node:test';
import { LogService } from '../application/services/LogService';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { MemoryBuffer } from '../infrastructure/buffer/MemoryBuffer';
import { LogFilter } from '../infrastructure/filter/LogFilter';

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('memory safety', () => {
  it('coalesces immediate flush requests', async () => {
    const onFlushRequested = mock.fn();
    const buffer = new MemoryBuffer({
      maxSize: 1,
      flushInterval: 60_000,
      maxAge: 60_000,
      autoFlush: true,
      maxMemoryMB: 1,
      onFlushRequested,
    });

    for (let index = 0; index < 100; index++) {
      buffer.add({
        id: String(index),
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'bounded',
        labels: {},
        metadata: {},
      });
    }

    await nextTurn();
    assert.strictEqual((onFlushRequested).mock.calls.length, 1);
    buffer.destroy();
  });

  it('bounds large structured contexts before buffering', () => {
    const filter = new LogFilter({
      levels: ['info'],
      patterns: [],
      samplingRate: 1,
      maxMessageLength: 2048,
      maxContextBytes: 256,
      sanitize: true,
      sensitivePatterns: [/password/i],
    });

    const filtered = filter.filter({
      id: '1',
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'large context',
      context: {
        payload: 'x'.repeat(100_000),
        password: 'secret',
      },
      labels: {},
      metadata: {},
    });

    assert.ok((JSON.stringify(filtered.context)).includes('truncated'));
    lessThan(Buffer.byteLength(JSON.stringify(filtered.context), 'utf8'), 1024);
  });

  it('drops old queued batches when the flush backlog reaches its limit', async () => {
    const transportResolvers: Array<() => void> = [];
    const transport = {
      send: mock.fn(() => new Promise<void>((resolve) => transportResolvers.push(resolve))),
      isAvailable: mock.fn(async () => true),
      getHealth: mock.fn(() => ({ healthy: true, consecutiveFailures: 0 })),
      destroy: mock.fn(async () => undefined),
    };
    const buffer = {
      size: mock.fn(() => 0),
      flush: mock.fn(() => []),
      getMetrics: mock.fn(() => ({
        size: 0,
        maxSize: 10,
        memoryUsageMB: 0,
        droppedEntries: 0,
      })),
      destroy: mock.fn(),
      setFlushCallback: mock.fn(),
    };
    const filter = {
      isLevelEnabled: mock.fn(() => true),
      shouldProcess: mock.fn(() => true),
      filter: mock.fn((entry) => entry),
    };
    const contextProvider = {
      getContext: mock.fn(() => ({})),
      runWithContext: mock.fn((_context, fn) => fn()),
      runWithContextAsync: mock.fn((_context, fn) => fn()),
    };
    const service = new LogService(
      filter as any,
      buffer as any,
      transport as any,
      contextProvider as any,
      {
        appName: 'test',
        version: '1.0.0',
        environment: 'test',
        labels: {},
        dynamicLabels: {},
        enableMetrics: true,
        maxConcurrentFlushes: 1,
        maxPendingBatches: 2,
      }
    );

    const enqueue = (id: string) => (service as any).enqueueFlush([{
      id,
      timestamp: new Date().toISOString(),
      level: 'info',
      message: id,
      labels: {},
      metadata: {},
    }]);

    const pending = [enqueue('1'), enqueue('2'), enqueue('3'), enqueue('4')];
    assert.strictEqual(((service as any).flushQueue).length, 2);
    assert.strictEqual((service.getMetrics().droppedByBackpressure), 1);

    for (let index = 0; index < 3; index++) {
      transportResolvers.shift()?.();
      await nextTurn();
    }

    await Promise.all(pending);
    assert.strictEqual((service.getMetrics().pendingFlushBatches), 0);
    assert.strictEqual((service.getMetrics().inFlightFlushes), 0);
  });
});
