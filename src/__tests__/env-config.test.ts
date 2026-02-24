import { loadConfigFromEnv } from '../utils';

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

    expect(config.transport?.url).toBe(process.env.LOGS_URL);
    expect(config.transport?.tenantId).toBe('tenant-a');
    expect(config.appName).toBe('app-a');
  });

  it('should preserve explicit zero values', () => {
    process.env.LOGS_URL = 'https://loki.example.com/loki/api/v1/push';
    process.env.LOGS_TENANT = 'tenant-a';
    process.env.LOGS_APP_NAME = 'app-a';
    process.env.LOGS_TIMEOUT = '0';
    process.env.LOGS_MAX_RETRIES = '0';
    process.env.LOGS_RETRY_DELAY = '0';
    process.env.LOGS_FILTER_SAMPLING_RATE = '0.0';
    process.env.LOGS_COMPRESSION_LEVEL = '0';

    const config = loadConfigFromEnv();

    expect(config.transport?.timeout).toBe(0);
    expect(config.transport?.maxRetries).toBe(0);
    expect(config.transport?.retryDelay).toBe(0);
    expect(config.filter?.samplingRate).toBe(0);
    expect(config.transport?.compressionLevel).toBe(0);
  });

  it('should load labels from LOGS_LABEL_* prefix', () => {
    process.env.LOGS_URL = 'https://loki.example.com/loki/api/v1/push';
    process.env.LOGS_TENANT = 'tenant-a';
    process.env.LOGS_APP_NAME = 'app-a';
    process.env.LOGS_LABEL_SERVICE = 'busca-prd';
    process.env.LOGS_LABEL_ENVIRONMENT = 'prd';

    const config = loadConfigFromEnv();

    expect(config.labels).toEqual({
      service: 'busca-prd',
      environment: 'prd',
    });
  });
});
