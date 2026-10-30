import { createServer } from 'node:http';
import { destroy, getLogger, init, isInitialized } from '../index';
import { validateMatcherPatterns } from '../infrastructure/privacy/MatcherPolicy';

afterEach(async () => { await destroy(); });

test('over-budget configuration is rejected before visiting any pattern', () => {
  const patterns = new Array<RegExp>(33);
  Object.defineProperty(patterns, 0, { get() { throw new Error('MUST_NOT_VISIT_PATTERN'); } });
  expect(validateMatcherPatterns(patterns)).toBe(false);
});

test('a rejected combined matcher plan does not retire the active logger', async () => {
  const config = {
    appName: 'existing-business-logger',
    transport: { type: 'otlp' as const, url: 'http://127.0.0.1:9', maxRetries: 0 },
    buffer: { autoFlush: false },
  };
  const active = init(config);
  expect(() => init({ ...config, filter: {
    sensitivePatterns: Array.from({ length: 32 }, () => /a{80}/),
    patterns: Array.from({ length: 32 }, () => /b{80}/),
  } })).toThrow('ELVEN_MATCHER_COMPILE_BUDGET');
  expect(isInitialized()).toBe(true);
  expect(getLogger()).toBe(active);
  active.info('business continuation');
  expect(active.getMetrics().logsProcessed).toBe(1);
  const internal = active as unknown as { buffer: { flush(): unknown[] } };
  expect(internal.buffer.flush()).toHaveLength(1);
});

test('custom linear policy covers the whole OTLP wire, all fields and selectors without mutating callers', async () => {
  const bodies: Buffer[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => { bodies.push(Buffer.concat(chunks)); res.end(); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const labels = Object.freeze({ static: 'PRIVATE_9301', plain: 'plain-label' });
  const context = Object.freeze({
    private_field: 'key-value-control-9302',
    value: 'PRIVATE_9303',
    nested: Object.freeze({ array: Object.freeze(['PRIVATE_9304', 'plain-array']) }),
  });
  const pattern = /private_field|PRIVATE_\d+/g;
  pattern.lastIndex = 19;
  try {
    const port = (server.address() as { port: number }).port;
    const logger = init({
      appName: 'major-matcher-wire', labels,
      dynamicLabels: { dynamic: () => 'PRIVATE_9305' },
      filter: { sensitivePatterns: [pattern], patterns: [/^keep/] },
      transport: { type: 'otlp', url: `http://127.0.0.1:${port}`, compression: 'none', maxRetries: 0 },
      buffer: { autoFlush: false },
    });
    logger.info('keep public-message', context);
    logger.info('keep PRIVATE_9306');
    logger.info('drop PRIVATE_9307');
    await logger.flush();
    expect(bodies).toHaveLength(1);
    const wire = bodies[0];
    for (const value of ['PRIVATE_9301', 'key-value-control-9302', 'PRIVATE_9303', 'PRIVATE_9304', 'PRIVATE_9305', 'PRIVATE_9306', 'PRIVATE_9307']) {
      expect(wire.includes(Buffer.from(value))).toBe(false);
    }
    expect(wire.includes(Buffer.from('keep public-message'))).toBe(true);
    expect(wire.includes(Buffer.from('plain-array'))).toBe(true);
    expect(wire.includes(Buffer.from('plain-label'))).toBe(true);
    expect(logger.getMetrics().logsProcessed).toBe(2);
    expect(logger.getMetrics().logsDropped).toBe(1);
    expect(logger.getHealth().privacyDiagnostics).toEqual([]);
    expect(pattern.lastIndex).toBe(19);
    expect(labels.static).toBe('PRIVATE_9301');
    expect(context.nested.array[0]).toBe('PRIVATE_9304');
    expect(Object.isFrozen(context.nested.array)).toBe(true);
  } finally {
    await destroy(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('accepted policy with unsupported live Unicode fails closed without throwing through business logging', async () => {
  const logger = init({
    appName: 'major-live-policy', filter: { sensitivePatterns: [/./u] },
    transport: { type: 'otlp', url: 'http://127.0.0.1:9', maxRetries: 0 }, buffer: { autoFlush: false },
  });
  expect(() => logger.info('\ud800')).not.toThrow();
  expect(logger.getHealth().privacyDiagnostics).toEqual(['ELVEN_MATCHER_UNSUPPORTED_INPUT']);
  expect(logger.getHealth().healthy).toBe(false);
  // Inspect the bounded buffer instead of deliberately exporting to an offline collector.
  const internal = logger as unknown as { buffer: { flush(): Array<{ message: string }> } };
  expect(internal.buffer.flush()[0].message).toBe('[REDACTED]');
});
