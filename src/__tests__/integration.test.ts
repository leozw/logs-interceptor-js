import assert from 'node:assert/strict';
import { greaterOrEqual, rejectsToThrow } from '../../test-support/assertions';
import { afterEach, describe, it, mock } from 'node:test';
/**
 * Integration Tests for logs-interceptor
 */
import { destroy, getLogger, init } from '../index';

describe('Logs Interceptor - Integration Tests', () => {
  afterEach(async () => {
    await destroy().catch(() => {
      // ignore cleanup errors in tests
    });
    mock.reset();
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

      assert.notStrictEqual((instance), undefined);
      assert.strictEqual((getLogger()), instance);
    });

    it('should throw error with invalid config', () => {
      assert.throws((() => {
        init({
          transport: {
            url: '',
            tenantId: 'test',
            useWorkers: false,
          },
          appName: 'test',
        });
      }));
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

      assert.doesNotThrow((() => {
        instance.debug('Debug message');
        instance.info('Info message');
        instance.warn('Warning message');
        instance.error('Error message');
      }));
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
      greaterOrEqual(metrics.logsProcessed, 2);
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
      await rejectsToThrow(instance.flush());
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
      assert.notStrictEqual((metrics), undefined);
      greaterOrEqual(metrics.logsProcessed, 0);
      greaterOrEqual(metrics.bufferSize, 0);
      greaterOrEqual(metrics.droppedByBackpressure, 0);
      greaterOrEqual(metrics.droppedByDlq, 0);
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
      assert.notStrictEqual((health), undefined);
      assert.strictEqual((typeof health.healthy), 'boolean');
      greaterOrEqual(health.uptime, 0);
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

      assert.notStrictEqual((instance), undefined);
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

      assert.notStrictEqual((instance), undefined);
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

      assert.notStrictEqual((instance), undefined);
    });
  });
});
