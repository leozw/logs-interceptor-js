import { createServer } from 'node:http';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { init, destroy } from '../index';
import { ConfigService } from '../application/services/ConfigService';
import {
  safeStringify,
  detectSensitiveData,
  loadConfigFromEnv,
} from '../utils';
import { WorkerPool } from '../infrastructure/workers/WorkerPool';
import { MemoryTracker } from '../infrastructure/memory/MemoryTracker';
import { FileDeadLetterQueue } from '../infrastructure/dlq/FileDeadLetterQueue';
import { ConsoleInterceptor } from '../infrastructure/interceptors/ConsoleInterceptor';
import { LogService } from '../application/services/LogService';
import { MemoryBuffer } from '../infrastructure/buffer/MemoryBuffer';
import { LogFilter } from '../infrastructure/filter/LogFilter';
import { AsyncLocalStorageContextProvider } from '../infrastructure/context/AsyncLocalStorageContextProvider';
import { ResilientTransport } from '../infrastructure/transport/ResilientTransport';
import { WinstonTransport } from '../infrastructure/integrations/WinstonTransport';
import * as api from '../index';
import register from '../presentation/node-red/logs-interceptor-node';
import { logExportSuppression } from '../infrastructure/transport/ExportSuppression';

afterEach(async () => {
  await destroy();
});

test('shutdown deadline settles even when a transport has not completed its send', async () => {
  let complete!: () => void;
  const transport = {
    send: () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    destroy: jest.fn(async () => {
      complete();
    }),
    getHealth: () => ({ healthy: true, consecutiveFailures: 0 }),
    getMetrics: () => undefined,
    isAvailable: async () => true,
  };
  const config = ConfigService.resolve({
    appName: 'deadline',
    transport: { type: 'otlp', url: 'http://localhost' },
    buffer: { autoFlush: false },
  });
  const service = new LogService(
    new LogFilter(config.filter),
    new MemoryBuffer(config.buffer),
    transport,
    new AsyncLocalStorageContextProvider(),
    {
      ...config,
      maxConcurrentFlushes: 1,
      maxPendingBatches: 1,
      shutdownTimeoutMillis: 25,
    },
  );
  service.info('pending');
  const flush = service.flush();
  await expect(service.destroy()).rejects.toThrow('deadline exceeded');
  await flush;
  expect(transport.destroy).toHaveBeenCalledTimes(1);
});

test('destroy cancels retry backoff without performing another network attempt', async () => {
  const base = {
    send: jest.fn(async () => {
      throw Object.assign(new Error('offline'), { code: 'ECONNREFUSED' });
    }),
    destroy: jest.fn(async () => undefined),
    getHealth: () => ({ healthy: false, consecutiveFailures: 1 }),
    getMetrics: () => undefined,
    isAvailable: async () => false,
  };
  const transport = new ResilientTransport(base, {
    maxRetries: 5,
    retryDelay: 10000,
  });
  const pending = transport
    .send([{ id: '1', level: 'info', timestamp: '', message: 'test' }])
    .catch((error) => error);
  await new Promise((resolve) => setImmediate(resolve));
  await transport.destroy();
  expect((await pending).message).toContain('closed');
  expect(base.send).toHaveBeenCalledTimes(1);
});

test('Winston callback follows notification so the stream can apply backpressure', async () => {
  const events: string[] = [];
  const transport = new WinstonTransport({
    logger: { info: jest.fn() } as any,
  });
  transport.on('logged', () => events.push('logged'));
  transport.log({ level: 'info', message: 'test' }, () =>
    events.push('callback'),
  );
  expect(events).toEqual([]);
  await new Promise((resolve) => setImmediate(resolve));
  expect(events).toEqual(['logged', 'callback']);
});

test('Node-RED forwards application messages even when logging fails', () => {
  const logger = api.init({
    appName: 'node-red-test',
    transport: { type: 'otlp', url: 'http://localhost' },
    buffer: { autoFlush: false },
  });
  const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {
    throw new Error('log failure');
  });
  const spy = jest.spyOn(api, 'init').mockReturnValue(logger);
  let Constructor: any;
  let input: any;
  const send = jest.fn();
  const RED = {
    nodes: {
      registerType: (_name: string, ctor: any) => {
        Constructor = ctor;
      },
      createNode: (node: any) =>
        Object.assign(node, {
          status: jest.fn(),
          log: jest.fn(),
          error: jest.fn(),
          warn: jest.fn(),
          send,
          on: (name: string, fn: any) => {
            if (name === 'input') input = fn;
          },
        }),
    },
    httpAdmin: { get: jest.fn() },
  };
  try {
    register(RED);
    new Constructor({
      appName: 'node-red',
      url: 'http://localhost',
      tenantId: 'test',
    });
    const message = { payload: { value: 1n } };
    input(message);
    expect(send).toHaveBeenCalledWith(message);
  } finally {
    spy.mockRestore();
    infoSpy.mockRestore();
  }
});

test('retiring console wrappers cannot replace newer instrumentation', () => {
  const originals = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const fakeLogger = { log: jest.fn() } as any;
  const first = new ConsoleInterceptor(fakeLogger, false);
  first.enable();
  const second = new ConsoleInterceptor(fakeLogger, false);
  second.enable();
  const current = console.info;
  first.restore();
  expect(console.info).toBe(current);
  second.restore();
  // second captured the first wrapper; restore the application method for this test.
  Object.assign(console, originals);
});

test('console capture excludes its own asynchronous export diagnostics without an OTel context manager', async () => {
  const log = jest.fn();
  const interceptor = new ConsoleInterceptor({ log } as any, false);
  interceptor.enable();
  try {
    await logExportSuppression.run(true, async () => {
      await Promise.resolve();
      console.info('internal export diagnostics');
    });
    expect(log).not.toHaveBeenCalled();
    console.info('application log');
    expect(log).toHaveBeenCalledTimes(1);
  } finally { interceptor.restore(); }
});

test('bounded serialization does not invoke getters, toJSON, or expand Buffers', () => {
  let calls = 0;
  const input = {
    buffer: Buffer.alloc(10_000_000),
    toJSON: () => {
      calls++;
      return 'leak';
    },
    get password() {
      calls++;
      throw new Error('application getter');
    },
  };
  const serialized = safeStringify(input);
  expect(calls).toBe(0);
  expect(serialized).toContain('10000000 bytes');
  expect(serialized.length).toBeLessThan(1024);
  const wide = Object.fromEntries(
    Array.from({ length: 10000 }, (_, i) => [
      String(i),
      { content: 'x'.repeat(1000) },
    ]),
  );
  expect(safeStringify(wide).length).toBeLessThan(20000);
  expect(safeStringify({ one: 1n })).toContain('1n');
});

test('global regexes are deterministic and dangerous custom patterns fail validation', () => {
  const patterns = [/token/g];
  expect(detectSensitiveData('token', patterns)).toBe(true);
  expect(detectSensitiveData('token', patterns)).toBe(true);
  expect(
    ConfigService.validate({
      appName: 'test',
      transport: { url: 'http://localhost', type: 'otlp' },
      filter: { patterns: [/(a+)+$/] },
    }).join(),
  ).toContain('safe regular expressions');
  expect(
    ConfigService.validate({
      appName: 'test',
      transport: {
        url: 'file:///etc/passwd',
        type: 'otlp',
        maxRetries: Infinity,
      },
    }).join(),
  ).toContain('finite');
});

test('memory accounting includes nested Buffer data', () => {
  const tracker = new MemoryTracker();
  const entry = {
    id: '1',
    timestamp: '',
    level: 'info' as const,
    message: '',
    context: { nested: { payload: Buffer.alloc(1_000_000) } },
  };
  tracker.addEntry(entry);
  expect(tracker.getTotalSize()).toBeGreaterThanOrEqual(1_000_000);
  tracker.removeEntry(entry);
  expect(tracker.getTotalSize()).toBe(0);
});

test('workers bound saturation, settle active tasks on destroy, and reject new work', async () => {
  const pool = new WorkerPool({
    maxWorkers: 1,
    maxQueueSize: 1,
    taskTimeout: 200,
    workerScript: join(__dirname, 'fixtures/worker.cjs'),
  });
  const active = pool
    .execute('process', 'hang')
    .catch((error) => error.message);
  const queued = pool
    .execute('process', 'queued')
    .catch((error) => error.message);
  await expect(pool.execute('process', 'overflow')).rejects.toThrow(
    'queue limit',
  );
  expect(pool.getMetrics().queueLength).toBe(1);
  await pool.destroy();
  expect(await active).toContain('destroyed');
  expect(await queued).toContain('destroyed');
  await expect(pool.execute('process', 'late')).rejects.toThrow('destroyed');
});

test('workers recover after clone failure, timeout, and a clean early exit', async () => {
  const pool = new WorkerPool({
    maxWorkers: 1,
    taskTimeout: 500,
    workerScript: join(__dirname, 'fixtures/worker.cjs'),
  });
  try {
    await expect(pool.execute('process', () => 1)).rejects.toThrow();
    const normal = await pool.execute<{
      data: string;
      execArgv: string[];
      nodeOptions?: string;
    }>('process', 'normal');
    expect(normal.data).toBe('normal');
    expect(normal.execArgv).toEqual([]);
    expect(normal.nodeOptions).toBeUndefined();
    await expect(pool.execute('process', 'hang')).rejects.toThrow('timeout');
    await expect(pool.execute('process', 'exit')).rejects.toThrow('code 0');
    await expect(pool.execute('process', 'crash')).rejects.toThrow(
      'fixture crash',
    );
    expect((await pool.execute('process', 'recovered')).data).toBe('recovered');
  } finally {
    await pool.destroy();
  }
});

test('oversized single file DLQ entry terminates, private files do not expose contents', async () => {
  const dir = mkdtempSync(join(__dirname, '.dlq-test-'));
  try {
    const dlq = new FileDeadLetterQueue({
      basePath: dir,
      maxFileSizeMB: 0.001,
    });
    await dlq.add(
      { id: '1', timestamp: '', level: 'info', message: 'x'.repeat(5000) },
      'failed',
    );
    expect(dlq.size()).toBe(0);
    const file = join(dir, '.logs-interceptor-dlq/dlq-current.jsonl');
    expect(readFileSync(file, 'utf8')).toBe('');
    expect(statSync(file).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.each(['base', 'exact'])(
  'real compressed OTLP export (%s) is bounded, redacted, and correlated',
  async (mode) => {
    const bodies: Buffer[] = [];
    const paths: string[] = [];
    const server = createServer((req, res) => {
      paths.push(req.url!);
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        bodies.push(
          req.headers['content-encoding'] === 'gzip' ? gunzipSync(body) : body,
        );
        res.writeHead(200, { 'content-type': 'application/x-protobuf' });
        res.end();
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    try {
      const address = server.address() as { port: number };
      const url = `http://127.0.0.1:${address.port}`;
      const logger = init({
        appName: 'audit-test',
        transport: {
          type: 'otlp',
          url,
          ...(mode === 'exact' ? { logsUrl: `${url}/gateway/custom` } : {}),
          compression: 'gzip',
          maxRetries: 0,
        },
        buffer: { autoFlush: false },
        dynamicLabels: { request_id: () => 'request-123' },
      });
      logger.info('local-log', {
        password: 'private-value',
        token: 'secret-value',
        payload: Buffer.alloc(2_000_000),
      });
      await logger.flush();
      expect(paths).toEqual([
        mode === 'exact' ? '/gateway/custom' : '/v1/logs',
      ]);
      const body = Buffer.concat(bodies).toString();
      expect(body).toContain('local-log');
      expect(body).toContain('request-123');
      expect(body).toContain('2000000 bytes');
      expect(body).not.toContain('private-value');
      expect(body).not.toContain('secret-value');
      expect(bodies[0].length).toBeLessThan(20_000);
      await Promise.all([logger.destroy(), logger.destroy()]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test('signal-specific OTLP environment endpoint stays exact', () => {
  const config = loadConfigFromEnv({
    LOGS_TRANSPORT: 'otlp',
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: 'https://collector.test/custom/logs',
  });
  expect(config.transport?.logsUrl).toBe('https://collector.test/custom/logs');
});
