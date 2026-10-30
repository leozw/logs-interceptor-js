import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { loadConfigFromEnv } from '../utils';
import { ConfigService } from '../application/services/ConfigService';

describe('Environment configuration (LOGS_*)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load required LOGS_* fields', () => {
    process.env.LOGS_URL = 'https://loki.example.com/loki/api/v1/push';
    process.env.LOGS_TENANT = 'tenant-a';
    process.env.LOGS_APP_NAME = 'app-a';

    const config = loadConfigFromEnv();

    assert.strictEqual((config.transport?.url), process.env.LOGS_URL);
    assert.strictEqual((config.transport?.tenantId), 'tenant-a');
    assert.strictEqual((config.appName), 'app-a');
  });

  it('should use the shared OTLP collector without Loki credentials', () => {
    process.env.LOGS_TRANSPORT = 'otlp';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';
    process.env.LOGS_APP_NAME = 'app-a';
    delete process.env.LOGS_URL;
    delete process.env.LOGS_TENANT;
    delete process.env.LOGS_TOKEN;

    const config = loadConfigFromEnv();
    const errors = ConfigService.validate(config);

    assert.strictEqual((config.transport?.type), 'otlp');
    assert.strictEqual((config.transport?.url), 'http://collector:4318');
    assert.strictEqual((config.transport?.tenantId), '');
    assert.strictEqual((config.transport?.authToken), undefined);
    assert.deepStrictEqual((errors), []);
  });

  it('should preserve explicit zero values', () => {
    process.env.LOGS_URL = 'https://loki.example.com/loki/api/v1/push';
    process.env.LOGS_TENANT = 'tenant-a';
    process.env.LOGS_APP_NAME = 'app-a';
    process.env.LOGS_TIMEOUT = '0';
    process.env.LOGS_MAX_RETRIES = '0';
    process.env.LOGS_RETRY_DELAY = '0';
    process.env.LOGS_FILTER_SAMPLING_RATE = '0.0';
    process.env.LOGS_FILTER_MAX_CONTEXT_BYTES = '4096';
    process.env.LOGS_MAX_PENDING_BATCHES = '3';
    process.env.LOGS_COMPRESSION_LEVEL = '0';

    const config = loadConfigFromEnv();

    assert.strictEqual((config.transport?.timeout), 0);
    assert.strictEqual((config.transport?.maxRetries), 0);
    assert.strictEqual((config.transport?.retryDelay), 0);
    assert.strictEqual((config.filter?.samplingRate), 0);
    assert.strictEqual((config.filter?.maxContextBytes), 4096);
    assert.strictEqual((config.performance?.maxPendingBatches), 3);
    assert.strictEqual((config.transport?.compressionLevel), 0);
  });

  it('should load labels from LOGS_LABEL_* prefix', () => {
    process.env.LOGS_URL = 'https://loki.example.com/loki/api/v1/push';
    process.env.LOGS_TENANT = 'tenant-a';
    process.env.LOGS_APP_NAME = 'app-a';
    process.env.LOGS_LABEL_SERVICE = 'busca-prd';
    process.env.LOGS_LABEL_ENVIRONMENT = 'prd';

    const config = loadConfigFromEnv();

    assert.deepStrictEqual((config.labels), {
      service: 'busca-prd',
      environment: 'prd',
    });
  });

  it('should resolve economy defaults without worker threads', () => {
    const config = ConfigService.resolve({
      appName: 'app-a',
      transport: {
        url: 'https://loki.example.com/loki/api/v1/push',
        tenantId: 'tenant-a',
      },
    });

    assert.strictEqual((config.transport.timeout), 5_000);
    assert.strictEqual((config.transport.maxRetries), 1);
    assert.strictEqual((config.transport.useWorkers), false);
    assert.strictEqual((config.transport.maxSockets), 10);
    assert.strictEqual((config.buffer.maxMemoryMB), 32);
    assert.strictEqual((config.performance.maxConcurrentFlushes), 2);
    assert.strictEqual((config.performance.maxPendingBatches), 2);
  });
});
