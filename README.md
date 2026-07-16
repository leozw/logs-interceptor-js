# Elven Logs Interceptor

High-performance log interceptor for Node.js with Loki and OTLP collector transports, batching, compression, circuit breaker, and bounded queues.

## Installation

```bash
npm install elven-logs-interceptor
```

## Quick Start

```ts
import { init, logger } from 'elven-logs-interceptor';

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

## OTLP Collector Mode

Send logs to the same collector used by metrics and traces. The collector owns
tenant routing and backend credentials.

```ts
init({
  appName: 'billing-service',
  interceptConsole: true,
  transport: {
    type: 'otlp',
    url: 'http://otel-collector:4318',
    compression: 'gzip',
  },
});
```

For zero-code configuration:

```bash
export LOGS_TRANSPORT=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
export LOGS_APP_NAME=billing-service
```

The `/v1/logs` path is appended automatically. `LOGS_TENANT` and `LOGS_TOKEN`
are not required in this mode.

## Environment Variables (Official)

This version uses `LOGS_*` variables.

### Required for direct Loki mode

- `LOGS_URL`
- `LOGS_TENANT`
- `LOGS_APP_NAME`

### Core

- `LOGS_TOKEN`
- `LOGS_APP_VERSION`
- `LOGS_ENVIRONMENT`

### Transport

- `LOGS_TRANSPORT` (`loki|otlp`)
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

OTLP mode also honors `OTEL_EXPORTER_OTLP_ENDPOINT`,
`OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, and
`OTEL_EXPORTER_OTLP_LOGS_HEADERS`.

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
- `LOGS_FILTER_MAX_CONTEXT_BYTES`

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
- `LOGS_MAX_PENDING_BATCHES`
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
NODE_OPTIONS="--require elven-logs-interceptor/preload" node app.js
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
import { WinstonTransport, getLogger } from 'elven-logs-interceptor';

const interceptor = getLogger();

const winstonLogger = winston.createLogger({
  transports: [new WinstonTransport({ logger: interceptor })],
});
```

### Morgan

```ts
import morgan from 'morgan';
import { MorganAdapter, getLogger } from 'elven-logs-interceptor';

const interceptor = getLogger();
app.use(morgan('combined', { stream: MorganAdapter.createStream(interceptor) }));

// or
app.use(MorganAdapter.create('combined', interceptor));
```

## Resilience Model

- Retry for transient failures (`429`, `5xx`, timeouts/network errors)
- Circuit breaker with bounded half-open probes
- DLQ with bounded size and `drop-oldest` policy
- Bounded pending flush queue with `drop-oldest` backpressure
- Bounded serialized context and worker task queues
- Non-blocking behavior for application code paths

## License

MIT
