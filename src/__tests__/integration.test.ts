/**
 * Integration Tests for logs-interceptor
 * Tests core functionality and features
 */
import { getLogger, init } from '../index';

describe('Logs Interceptor - Integration Tests', () => {
  beforeEach(() => {
    // Clear any existing instance
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
            url: '', // Invalid: empty URL
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
        },
        appName: 'test',
        interceptConsole: false, // Don't intercept console in tests
      });

      expect(() => {
        instance.debug('Debug message');
        instance.info('Info message');
        instance.warn('Warning message');
        instance.error('Error message');
        instance.fatal('Fatal message');
      }).not.toThrow();
    });

    it('should track events', () => {
      const instance = init({
        transport: {
          url: 'https://loki.example.com/loki/api/v1/push',
          tenantId: 'test',
          useWorkers: false,
        },
        appName: 'test',
        interceptConsole: false,
      });

      expect(() => {
        instance.trackEvent('user_login', { userId: '123' });
      }).not.toThrow();
    });
  });

  describe('Flush', () => {
    it('should flush logs', async () => {
      const instance = init({
        transport: {
          url: 'https://loki.example.com/loki/api/v1/push',
          tenantId: 'test',
          useWorkers: false,
        },
        appName: 'test',
        interceptConsole: false,
        buffer: {
          maxSize: 10,
          flushInterval: 1000,
        },
      });

      instance.info('Test log');

      // Flush should throw because URL is invalid and ResilientTransport re-throws after DLQ
      await expect(instance.flush()).rejects.toThrow();
    });
  });

  describe('Metrics and Health', () => {
    it('should return metrics', () => {
      const instance = init({
        transport: {
          url: 'https://loki.example.com/loki/api/v1/push',
          tenantId: 'test',
          useWorkers: false,
        },
        appName: 'test',
        interceptConsole: false,
      });

      const metrics = instance.getMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.logsProcessed).toBeGreaterThanOrEqual(0);
      expect(metrics.bufferSize).toBeGreaterThanOrEqual(0);
    });

    it('should return health status', () => {
      const instance = init({
        transport: {
          url: 'https://loki.example.com/loki/api/v1/push',
          tenantId: 'test',
          useWorkers: false,
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
        },
        appName: 'test',
        interceptConsole: false,
      });

      expect(instance).toBeDefined();
    });

    it('should support connection pooling', () => {
      const instance = init({
        transport: {
          url: 'https://loki.example.com/loki/api/v1/push',
          tenantId: 'test',
          enableConnectionPooling: true,
          useWorkers: false,
        },
        appName: 'test',
        interceptConsole: false,
      });

      expect(instance).toBeDefined();
    });

    it('should support circuit breaker', () => {
      const instance = init({
        transport: {
          url: 'https://loki.example.com/loki/api/v1/push',
          tenantId: 'test',
          useWorkers: false,
        },
        appName: 'test',
        interceptConsole: false,
        circuitBreaker: {
          enabled: true,
          failureThreshold: 5,
          resetTimeout: 60000,
        },
      });

      expect(instance).toBeDefined();
    });

    it('should support Dead Letter Queue', () => {
      const instance = init({
        transport: {
          url: 'https://loki.example.com/loki/api/v1/push',
          tenantId: 'test',
          useWorkers: false,
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
