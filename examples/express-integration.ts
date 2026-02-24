/**
 * Complete Express.js Integration Example
 */
import express from 'express';
import os from 'os';
import { init, logger } from '../src';

init({
  transport: {
    url: process.env.LOGS_URL || 'https://loki.example.com/loki/api/v1/push',
    tenantId: process.env.LOGS_TENANT || 'my-tenant',
    authToken: process.env.LOGS_TOKEN,
    compression: 'brotli',
    compressionLevel: 4,
    useWorkers: true,
    enableConnectionPooling: true,
  },
  appName: process.env.LOGS_APP_NAME || 'my-api',
  version: process.env.LOGS_APP_VERSION || '1.0.0',
  environment: process.env.LOGS_ENVIRONMENT || process.env.NODE_ENV || 'development',
  labels: {
    service: 'demo',
    instance: os.hostname(),
  },
  interceptConsole: true,
  preserveOriginalConsole: true,
  buffer: {
    maxSize: 100,
    flushInterval: 5000,
    maxMemoryMB: 50,
  },
  filter: {
    levels: ['debug', 'info', 'warn', 'error', 'fatal'],
    sanitize: true,
    samplingRate: 1.0,
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    resetTimeout: 60_000,
  },
  deadLetterQueue: {
    enabled: true,
    type: 'file',
    maxSize: 1000,
    maxRetries: 3,
  },
  performance: {
    maxConcurrentFlushes: 5,
  },
  enableMetrics: true,
  enableHealthCheck: true,
  debug: process.env.LOGS_DEBUG === 'true',
});

const app = express();

app.use((req, _res, next) => {
  const requestId =
    req.headers['x-request-id'] ||
    `req-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  logger.withContext({ requestId }, () => {
    next();
  });
});

app.use((req, res, next) => {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const level =
      res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger.log(level, `${req.method} ${req.path}`, {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      type: 'http_request',
    });
  });

  next();
});

app.get('/ping', (_req, res) => {
  console.log('ping called');
  res.send({ message: 'pong' });
});

app.get('/erro', () => {
  throw new Error('Erro proposital');
});

app.get('/', (_req, res) => {
  res.json({ message: 'Hello World' });
});

const PORT = process.env.PORT || 3000;
logger.info('Application started', {
  port: PORT,
  environment: process.env.NODE_ENV,
  nodeVersion: process.version,
  pid: process.pid,
  hostname: os.hostname(),
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  await logger.flush();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully');
  await logger.flush();
  process.exit(0);
});

app.get('/health', (_req, res) => {
  const health = logger.getHealth();
  const metrics = logger.getMetrics();

  res.json({
    status: health.healthy ? 'healthy' : 'unhealthy',
    logger: {
      healthy: health.healthy,
      uptime: health.uptime,
      bufferUtilization: health.bufferUtilization,
      lastSuccessfulFlush: health.lastSuccessfulFlush,
      metrics: {
        logsProcessed: metrics.logsProcessed,
        logsDropped: metrics.logsDropped,
        bufferSize: metrics.bufferSize,
        latency: metrics.latency,
        compression: metrics.compression,
      },
    },
  });
});

app.listen(PORT, () => {
  console.log(`Application is running on port: ${PORT}`);
});

export default app;
