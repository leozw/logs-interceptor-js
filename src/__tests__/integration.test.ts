/**
 * Integration Tests for logs-interceptor
 */
import { destroy, getLogger, init } from '../index';

describe('Logs Interceptor - Integration Tests', () => {
  afterEach(async () => {
    await destroy().catch(() => {
      // ignore cleanup errors in tests
    });
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    it('should initialize with valid config', () => {
      const instance = init({
        transport: {
          url: 'https://loki.example.com/loki/api/v1/push',
          tenantId: 'test-tenant',
          authToken: 'test-token',
          useWorkers: false,
          enableConnectionPooling: false,
        },
        appName: 'test-app',
        environment: 'test',
      });

      expect(instance).toBeDefined();
      expect(getLogger()).toBe(instance);
    });

    it('should throw error with invalid config', () => {
      expect(() => {
        init({
          transport: {
            url: '',
            tenantId: 'test',
            useWorkers: false,
          },
          appName: 'test',
        });
      }).toThrow();
    });
  });

  describe('Logging', () => {
    it('should log messages at different levels', () => {
      const instance = init({
        transport: {
          url: 'https://loki.example.com/loki/api/v1/push',
          tenantId: 'test',
          useWorkers: false,
          enableConnectionPooling: false,
        },
        appName: 'test',
        interceptConsole: false,
      });

      expect(() => {
        instance.debug('Debug message');
        instance.info('Info message');
        instance.warn('Warning message');
        instance.error('Error message');
      }).not.toThrow();
    });

    it('should support context propagation API', async () => {
      const instance = init({
        transport: {
          url: 'https://loki.example.com/loki/api/v1/push',
          tenantId: 'test',
          useWorkers: false,
          enableConnectionPooling: false,
        },
        appName: 'test',
        interceptConsole: false,
      });

      instance.withContext({ requestId: 'req-123' }, () => {
        instance.info('context sync');
      });

      await instance.withContextAsync({ requestId: 'req-456' }, async () => {
        instance.info('context async');
      });

      const metrics = instance.getMetrics();
      expect(metrics.logsProcessed).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Flush', () => {
    it('should flush logs and propagate transport errors', async () => {
      const instance = init({
        transport: {
          url: 'https://loki.example.com/loki/api/v1/push',
          tenantId: 'test',
          useWorkers: false,
          enableConnectionPooling: false,
          maxRetries: 0,
          timeout: 100,
        },
        appName: 'test',
        interceptConsole: false,
        buffer: {
          maxSize: 10,
          flushInterval: 1000,
        },
      });

      instance.info('Test log');
      await expect(instance.flush()).rejects.toThrow();
    });
  });

  describe('Metrics and Health', () => {
    it('should return expanded metrics', () => {
      const instance = init({
        transport: {
          url: 'https://loki.example.com/loki/api/v1/push',
          tenantId: 'test',
          useWorkers: false,
          enableConnectionPooling: false,
        },
        appName: 'test',
        interceptConsole: false,
      });

      const metrics = instance.getMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.logsProcessed).toBeGreaterThanOrEqual(0);
      expect(metrics.bufferSize).toBeGreaterThanOrEqual(0);
      expect(metrics.droppedByBackpressure).toBeGreaterThanOrEqual(0);
      expect(metrics.droppedByDlq).toBeGreaterThanOrEqual(0);
    });

    it('should return health status', () => {
      const instance = init({
        transport: {
          url: 'https://loki.example.com/loki/api/v1/push',
          tenantId: 'test',
          useWorkers: false,
          enableConnectionPooling: false,
        },
        appName: 'test',
        interceptConsole: false,
      });

      const health = instance.getHealth();
      expect(health).toBeDefined();
      expect(typeof health.healthy).toBe('boolean');
      expect(health.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Features', () => {
    it('should support Brotli compression', () => {
      const instance = init({
        transport: {
          url: 'https://loki.example.com/loki/api/v1/push',
          tenantId: 'test',
          compression: 'brotli',
          compressionLevel: 4,
          useWorkers: false,
          enableConnectionPooling: false,
        },
        appName: 'test',
        interceptConsole: false,
      });

      expect(instance).toBeDefined();
    });

    it('should support Gzip compression', () => {
      const instance = init({
        transport: {
          url: 'https://loki.example.com/loki/api/v1/push',
          tenantId: 'test',
          compression: 'gzip',
          useWorkers: false,
          enableConnectionPooling: false,
        },
        appName: 'test',
        interceptConsole: false,
      });

      expect(instance).toBeDefined();
    });

    it('should support Dead Letter Queue', () => {
      const instance = init({
        transport: {
          url: 'https://loki.example.com/loki/api/v1/push',
          tenantId: 'test',
          useWorkers: false,
          enableConnectionPooling: false,
        },
        appName: 'test',
        interceptConsole: false,
        deadLetterQueue: {
          enabled: true,
          type: 'memory',
          maxSize: 1000,
        },
      });

      expect(instance).toBeDefined();
    });
  });
});
