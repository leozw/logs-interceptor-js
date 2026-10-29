import legacy, { init, getLogger, isInitialized, destroy, logger, LogLevelVO, WinstonTransport, MorganAdapter, type ILogger, type LogsInterceptorConfig, type ResolvedLogsInterceptorConfig } from '../dist';
import type { BufferMetrics } from '../dist/domain/interfaces/ILogBuffer';

const previousConfig: LogsInterceptorConfig = { appName: 'types-only', transport: { url: 'http://127.0.0.1:9/push', tenantId: 'synthetic' } };
const nextConfig: LogsInterceptorConfig = { ...previousConfig, indexCorrelationIds: false };
const instance: ILogger = init(nextConfig);
getLogger().info('types-only');
logger.trackEvent('types-only', { requestId: 'synthetic' });
const transport = new WinstonTransport({ logger: instance });
transport.log({ level: 'info', message: 'types-only' }, () => {});
MorganAdapter.createStream(instance).write('types-only');
new LogLevelVO('info');
const initialized: boolean = isInitialized();
const cleanup: Promise<void> = destroy();
const defaultCleanup: Promise<void> = legacy.destroy();
const oldBufferMetrics: BufferMetrics = { size: 0, maxSize: 100, memoryUsageMB: 0 };

// Existing resolved-config literals need no new mandatory property.
const previousResolved: ResolvedLogsInterceptorConfig = {
  transport: { url: 'http://127.0.0.1:9/push', tenantId: 'synthetic', authToken: '', timeout: 50, maxRetries: 0, retryDelay: 0, compression: 'none', compressionLevel: 6, compressionThreshold: 1024, useWorkers: false, enableConnectionPooling: true, maxSockets: 1 },
  appName: 'types-only', version: '1', environment: 'test', labels: {}, dynamicLabels: {},
  buffer: { maxSize: 1, flushInterval: 1000, maxAge: 1000, autoFlush: false, maxMemoryMB: 1 },
  filter: { levels: ['info'], patterns: [], samplingRate: 1, maxMessageLength: 8192, sanitize: true, sensitivePatterns: [] },
  circuitBreaker: { enabled: true, failureThreshold: 5, resetTimeout: 1000, halfOpenRequests: 1 },
  integrations: {}, performance: { useWorkers: true, maxConcurrentFlushes: 1, compressionLevel: 6, workerTimeout: 1000 },
  enableMetrics: true, enableHealthCheck: true, interceptConsole: false, preserveOriginalConsole: true, debug: false, silentErrors: true,
};
void [initialized, cleanup, defaultCleanup, oldBufferMetrics, previousResolved];
