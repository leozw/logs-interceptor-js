/**
 * Complete Express.js Integration Example
 * Captures all logs: console, errors, Express requests, etc.
 * 
 * Features demonstrated:
 * - Async compression (Brotli)
 * - Worker threads
 * - Connection pooling
 * - Dead Letter Queue
 * - Context propagation
 * - Health checks
 */
import express from 'express';
import { init, logger } from 'logs-interceptor';
import os from 'os';

// ✅ INICIALIZAÇÃO COMPLETA COM TODAS AS FEATURES
init({
  transport: {
    url: process.env.LOKI_URL || 'https://loki.example.com/loki/api/v1/push',
    tenantId: process.env.LOKI_TENANT || 'my-tenant',
    authToken: process.env.LOKI_TOKEN,
    // ✅ NEW: Async Compression (Default: 'gzip')
    compression: 'brotli', // 'gzip' | 'brotli' | 'none' - 15-20% better than gzip
    compressionLevel: 4,   // 0-11 for Brotli, 0-9 for Gzip
    // ✅ NEW: Worker Threads (Default: true)
    useWorkers: true,      // Process in background threads
    // ✅ NEW: Connection Pooling (Default: true)
    enableConnectionPooling: true, // Reuse HTTP connections
  },
  appName: 'my-api',
  version: '1.0.0',
  environment: process.env.NODE_ENV || 'development',
  labels: {
    service: 'demo',
    instance: os.hostname(),
  },
  // ✅ CAPTURA CONSOLE AUTOMATICAMENTE
  interceptConsole: true,
  preserveOriginalConsole: true, // Mantém console original também
  
  // ✅ BUFFER CONFIGURADO
  buffer: {
    maxSize: 100,
    flushInterval: 5000,
    maxMemoryMB: 50,
  },
  
  // ✅ FILTROS E SANITIZAÇÃO
  filter: {
    levels: ['debug', 'info', 'warn', 'error', 'fatal'],
    sanitize: true, // Remove dados sensíveis automaticamente
    samplingRate: 1.0, // 100% dos logs
  },
  
  // ✅ CIRCUIT BREAKER (proteção contra falhas)
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    resetTimeout: 60000,
  },
  
  // ✅ DEAD LETTER QUEUE (salva logs críticos que falharam)
  deadLetterQueue: {
    enabled: true,
    type: 'file', // ou 'memory'
    maxSize: 1000,
    maxRetries: 3,
  },
  
  // ✅ MÉTRICAS E HEALTH CHECK
  enableMetrics: true,
  enableHealthCheck: true,
  
  debug: process.env.NODE_ENV === 'development',
});

const app = express();

// ✅ MIDDLEWARE PARA CAPTURAR REQUEST ID
app.use((req, res, next) => {
  // Adiciona request ID ao contexto
  const requestId = req.headers['x-request-id'] || 
                    `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  logger.runWithContext({ requestId }, () => {
    next();
  });
});

// ✅ MIDDLEWARE PARA LOGAR REQUESTS DO EXPRESS
app.use((req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const level = res.statusCode >= 500 ? 'error' : 
                  res.statusCode >= 400 ? 'warn' : 'info';
    
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

// ✅ CAPTURA ERROS DO EXPRESS
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Express error handler', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    type: 'express_error',
  });
  
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Rotas
app.get("/ping", (req, res) => {
  console.log("ping chamado"); // ✅ Será capturado automaticamente
  res.send({ message: "pong" });
});

app.get("/erro", () => {
  throw new Error("Erro proposital"); // ✅ Será capturado automaticamente
});

// Your routes here
app.get('/', (req, res) => {
  res.json({ message: 'Hello World' });
});

// ✅ LOG DE INICIALIZAÇÃO
const PORT = process.env.PORT || 3000;
logger.info('Application started', {
  port: PORT,
  environment: process.env.NODE_ENV,
  nodeVersion: process.version,
  pid: process.pid,
  hostname: os.hostname(),
});

// ✅ GRACEFUL SHUTDOWN
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

// ✅ ENDPOINT DE HEALTH CHECK
app.get('/health', (req, res) => {
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
