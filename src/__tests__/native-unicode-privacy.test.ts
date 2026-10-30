import { createServer } from 'node:http';
import { destroy, init } from '../index';
import { ConfigService } from '../application/services/ConfigService';

const canary = 'OWNER_NATIVE_CANARY_57821';
const sites = ['message', 'selector', 'context-key', 'context-value', 'record-label', 'resource'] as const;
afterEach(async () => { await destroy(); });

describe.each(['default', 'generic-control'] as const)('%s malformed UTF-16 privacy', mode => {
  test.each(sites.flatMap(site => (['high', 'low'] as const).map(surrogate => [site, surrogate] as const)))(
    'whole OTLP wire fails closed: %s / %s', async (site, surrogate) => {
      const bodies: Buffer[] = [];
      const server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => { bodies.push(Buffer.concat(chunks)); res.end(); });
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const broken = surrogate === 'high' ? '\ud800' : '\udc00';
      const payload = broken + '{"pass\\u0077ord":"' + canary + '"}';
      const context = Object.freeze(site === 'context-key' ? { [broken + 'field']: canary } : site === 'context-value' ? { field: payload } : {});
      const sourceLabels: Record<string, string> = {};
      if (site === 'resource') sourceLabels.note = payload;
      const labels = Object.freeze(sourceLabels);
      const transport = { type: 'otlp' as const, url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, compression: 'none' as const, maxRetries: 0 };
      const defaults = ConfigService.resolve({ appName: 'native-unicode', transport }).filter.sensitivePatterns;
      try {
        const logger = init({
          appName: 'native-unicode', transport, labels, buffer: { autoFlush: false },
          dynamicLabels: site === 'record-label' ? { note: () => payload } : {},
          filter: {
            ...(mode === 'generic-control' ? { sensitivePatterns: [...defaults, /NEVER_GENERIC_MATCH_491/] } : {}),
            ...(site === 'selector' ? { patterns: [/token/i] } : {}),
          },
        });
        logger.info(site === 'selector' ? broken + 'token ' + payload : site === 'message' ? payload : 'ordinary event', context);
        await logger.flush();
        expect(bodies).toHaveLength(site === 'selector' ? 0 : 1);
        expect(Buffer.concat(bodies).includes(Buffer.from(canary))).toBe(false);
        expect(logger.getHealth().privacyDiagnostics).toEqual(['ELVEN_MATCHER_UNSUPPORTED_INPUT']);
        expect(logger.getHealth().healthy).toBe(false);
        if (site === 'selector') expect(logger.getMetrics().logsDropped).toBe(1);
        expect(Object.isFrozen(context)).toBe(true);
        expect(Object.isFrozen(labels)).toBe(true);
        if (site === 'resource') expect(labels.note).toBe(payload);
        if (site === 'context-value') expect(context.field).toBe(payload);
      } finally {
        await destroy(); server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
});

test('valid astral Unicode remains intact on default native policy, while ordinary PII still masks', async () => {
  const logger = init({ appName: 'unicode-control', transport: { type: 'otlp', url: 'http://127.0.0.1:9' }, buffer: { autoFlush: false } });
  const message = 'ordinary \ud83d\ude00 \u00a0 \ufeff';
  logger.info(message); logger.info('Bearer\u00a0synthetic-private');
  const internal = logger as unknown as { buffer: { flush(): { message: string }[] } };
  expect(internal.buffer.flush().map(entry => entry.message)).toEqual([message, '[REDACTED]']);
  expect(logger.getHealth().privacyDiagnostics).toEqual([]);
});

test('explicit sanitize false remains a privacy opt-out rather than a failure fallback', async () => {
  const logger = init({ appName: 'explicit-optout', filter: { sanitize: false }, transport: { type: 'otlp', url: 'http://127.0.0.1:9' }, buffer: { autoFlush: false } });
  const message = '\ud800' + canary;
  logger.info(message);
  const internal = logger as unknown as { buffer: { flush(): { message: string }[] } };
  expect(internal.buffer.flush()[0].message).toBe(message);
  expect(logger.getHealth().privacyDiagnostics).toEqual([]);
});
