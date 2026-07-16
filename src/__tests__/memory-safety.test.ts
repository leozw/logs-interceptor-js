import { LogService } from '../application/services/LogService';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { MemoryBuffer } from '../infrastructure/buffer/MemoryBuffer';
import { LogFilter } from '../infrastructure/filter/LogFilter';

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('memory safety', () => {
  it('coalesces immediate flush requests', async () => {
    const onFlushRequested = jest.fn();
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
    expect(onFlushRequested).toHaveBeenCalledTimes(1);
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

    expect(filtered.context?._truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(filtered.context), 'utf8')).toBeLessThan(1024);
  });

  it('drops old queued batches when the flush backlog reaches its limit', async () => {
    const transportResolvers: Array<() => void> = [];
    const transport = {
      send: jest.fn(
        () => new Promise<void>((resolve) => transportResolvers.push(resolve))
      ),
      isAvailable: jest.fn(async () => true),
      getHealth: jest.fn(() => ({ healthy: true, consecutiveFailures: 0 })),
      destroy: jest.fn(async () => undefined),
    };
    const buffer = {
      size: jest.fn(() => 0),
      flush: jest.fn(() => []),
      getMetrics: jest.fn(() => ({
        size: 0,
        maxSize: 10,
        memoryUsageMB: 0,
        droppedEntries: 0,
      })),
      destroy: jest.fn(),
      setFlushCallback: jest.fn(),
    };
    const filter = {
      isLevelEnabled: jest.fn(() => true),
      shouldProcess: jest.fn(() => true),
      filter: jest.fn((entry) => entry),
    };
    const contextProvider = {
      getContext: jest.fn(() => ({})),
      runWithContext: jest.fn((_context, fn) => fn()),
      runWithContextAsync: jest.fn((_context, fn) => fn()),
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
    expect((service as any).flushQueue).toHaveLength(2);
    expect(service.getMetrics().droppedByBackpressure).toBe(1);

    for (let index = 0; index < 3; index++) {
      transportResolvers.shift()?.();
      await nextTurn();
    }

    await Promise.all(pending);
    expect(service.getMetrics().pendingFlushBatches).toBe(0);
    expect(service.getMetrics().inFlightFlushes).toBe(0);
  });
});
