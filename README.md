# Logs Interceptor (V3)

High-performance log interceptor for Node.js with Loki transport, batching, compression, circuit breaker, and DLQ.

## Installation

```bash
npm install logs-interceptor
```

## Quick Start

```ts
import { init, logger } from 'logs-interceptor';

init({
  appName: 'billing-service',
  interceptConsole: true,
  transport: {
    url: process.env.LOGS_URL!,
    tenantId: process.env.LOGS_TENANT!,
    authToken: process.env.LOGS_TOKEN,
    compression: 'snappy',
    useWorkers: true,
  },
});

logger.info('service started', { port: 3000 });
```

## Environment Variables (Official)

This version uses `LOGS_*` variables.

### Required

- `LOGS_URL`
- `LOGS_TENANT`
- `LOGS_APP_NAME`

### Core

- `LOGS_TOKEN`
- `LOGS_APP_VERSION`
- `LOGS_ENVIRONMENT`

### Transport

- `LOGS_COMPRESSION` (`none|gzip|brotli|snappy`)
- `LOGS_COMPRESSION_LEVEL`
- `LOGS_COMPRESSION_THRESHOLD`
- `LOGS_USE_WORKERS`
- `LOGS_MAX_WORKERS`
- `LOGS_WORKER_TIMEOUT`
- `LOGS_CONNECTION_POOLING`
- `LOGS_MAX_SOCKETS`
- `LOGS_TIMEOUT`
- `LOGS_MAX_RETRIES`
- `LOGS_RETRY_DELAY`

### Buffer

- `LOGS_BUFFER_MAX_SIZE`
- `LOGS_BUFFER_FLUSH_INTERVAL`
- `LOGS_BUFFER_MAX_MEMORY_MB`
- `LOGS_BUFFER_MAX_AGE`
- `LOGS_BUFFER_AUTO_FLUSH`

### Filter

- `LOGS_FILTER_LEVELS` (`debug,info,warn,error,fatal`)
- `LOGS_FILTER_SAMPLING_RATE`
- `LOGS_FILTER_SANITIZE`
- `LOGS_FILTER_MAX_MESSAGE_LENGTH`

### Circuit Breaker

- `LOGS_CIRCUIT_BREAKER_ENABLED`
- `LOGS_CIRCUIT_BREAKER_FAILURE_THRESHOLD`
- `LOGS_CIRCUIT_BREAKER_RESET_TIMEOUT`
- `LOGS_CIRCUIT_BREAKER_HALF_OPEN_REQUESTS`

### DLQ

- `LOGS_DLQ_ENABLED`
- `LOGS_DLQ_TYPE` (`memory|file`)
- `LOGS_DLQ_MAX_SIZE`
- `LOGS_DLQ_MAX_RETRIES`
- `LOGS_DLQ_BASE_PATH`

### Runtime / Features

- `LOGS_MAX_CONCURRENT_FLUSHES`
- `LOGS_INTERCEPT_CONSOLE`
- `LOGS_PRESERVE_ORIGINAL_CONSOLE`
- `LOGS_ENABLE_METRICS`
- `LOGS_ENABLE_HEALTH_CHECK`
- `LOGS_DEBUG`
- `LOGS_SILENT_ERRORS`
- `LOGS_ENABLED`
- `LOGS_AUTO_INIT`

### Labels

Use `LOGS_LABEL_*` keys.

Example:

- `LOGS_LABEL_SERVICE=busca-prd`
- `LOGS_LABEL_ENVIRONMENT=prd`

## Auto-Init Behavior

No automatic init by default on import.

- Set `LOGS_AUTO_INIT=true` to enable opt-in auto-init.
- `preload.js` sets this automatically.

## Preload (Zero-Code)

```bash
NODE_OPTIONS="--require logs-interceptor/preload" node app.js
```

## Context Propagation

```ts
logger.withContext({ requestId: 'req-123' }, () => {
  logger.info('inside context');
});

await logger.withContextAsync({ requestId: 'req-456' }, async () => {
  logger.info('inside async context');
});
```

## Integrations

### Winston

```ts
import winston from 'winston';
import { WinstonTransport, getLogger } from 'logs-interceptor';

const interceptor = getLogger();

const winstonLogger = winston.createLogger({
  transports: [new WinstonTransport({ logger: interceptor })],
});
```

### Morgan

```ts
import morgan from 'morgan';
import { MorganAdapter, getLogger } from 'logs-interceptor';

const interceptor = getLogger();
app.use(morgan('combined', { stream: MorganAdapter.createStream(interceptor) }));

// or
app.use(MorganAdapter.create('combined', interceptor));
```

## Resilience Model

- Retry for transient failures (`429`, `5xx`, timeouts/network errors)
- Circuit breaker with bounded half-open probes
- DLQ with bounded size and `drop-oldest` policy
- Non-blocking behavior for application code paths

## License

MIT
