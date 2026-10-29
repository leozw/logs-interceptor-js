# Elven Logs Interceptor

Candidate `1.1.1`; publication is coordinated separately.
Official [Node.js integration guide](https://docs.elven.works/elven-observability/integracao-e-instrumentacao/javascript/instrumentacao-node.js-com-elven-observability.html)
and [documentation source](https://github.com/elvenworks-ps/docs.elven.works).

## Compatibility And Limits

The production compatibility floor is `^18.19.0 || >=20.6.0`, matching the OTel
`2.12.x` / `0.223.x` generation. Node 18/20 are EOL, not maintained deployment
targets. Prefer patched Node 22/24/26; see [Node releases](https://nodejs.org/en/about/previous-releases).
OTel 3.x requires a separate major migration. CJS and native ESM imports are
supported; the package itself remains CommonJS.

`logs-interceptor@2.1.6` is a separate legacy npm identity, not an alias silently
redirected by this package. Audit its API/config and migrate explicitly; the
larger version number does not mean it is newer than `elven-logs-interceptor`.

Graphs are copied before queueing, without invoking getters or `toJSON`.
Snapshots use shared limits of 500 nodes, depth 8, 100 array elements and a
text budget; Buffer/typed-array payloads become size summaries. Console capture
limits 32 arguments and 8192 characters; original console output, when enabled,
still receives the original arguments and is NOT sanitized by this library.
Disable preservation or sanitize at the application source for stdout privacy.
Custom regexes are conservatively checked with safe-regex2, capped to 32 patterns
and 256 source characters each. This heuristic is not a proof of linear time;
only trusted configuration belongs here. Built-in email scanning is bounded.

Buffer memory accounting includes nested payloads but is an estimate, not a
process RSS limit. Defaults retain 100 entries, 2 active and 2 queued batches;
DLQ, retry, serialization, native compression and Workers use additional memory.
Config rejects non-finite values and extreme queue, payload, timeout and worker
sizes. Retries are capped to 5 and backoff to 30 seconds. Loki requests have a
whole-request deadline and a 64 KiB response budget. Export operations suppress
tracing to avoid tracing their own HTTP requests. Correlation IDs remain log
fields instead of automatically creating one Loki stream per request. Custom
dynamic labels still require a low-cardinality value set.

Idle timers and Workers do not pin process exit. Manual drain defaults to a
10-second deadline (`performance.shutdownTimeoutMillis`, maximum 60 seconds),
followed by transport cleanup. Expired drains reject and cancel queued work,
backoff sleeps and active Loki/OTLP connections; this may drop pending telemetry.
Await `logger.destroy()` before
exit to drain; outstanding work is not durable delivery. Preload skips Workers;
child/cluster processes initialize independently. Internal Workers strip inherited
`NODE_OPTIONS`. File DLQ is opt-in, plaintext, single-process storage; use a
distinct private directory per process. No automatic replay is promised.

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
`OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` is an exact endpoint and is not suffixed.
In code, set `transport.logsUrl` for an exact custom gateway path; `transport.url`
continues to mean the collector base URL.

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

## Maintainer Release Gates

The manual `.github/workflows/release.yml` accepts only `main`, an exact current
SHA, stable version and typed package confirmation. It requires successful
Node 22/24/26 main-push CI for that SHA, a public matching repository, a clean
production audit and the validated archive hash. Only the final hosted publish
job receives `NPM_TOKEN`; `id-token: write` and `--provenance` remain mandatory.
There are no push/tag publication triggers and no provenance fallback.

An authorized maintainer must configure `NPM_TOKEN` in this package's matching
GitHub repository before dispatch. No token was read, created or changed by the
audit, and trusted-publisher configuration is not assumed. A coordinator token
in another repository does not establish this package's provenance. This
workflow was prepared, not dispatched. See the [npm provenance requirements](https://docs.npmjs.com/generating-provenance-statements/).

The legacy `logs-interceptor@2.1.6` is a separate identity, not an npm alias.
Do not substitute it without translating `LOGS_INTERCEPTOR_*` configuration and
qualifying the transport, preload and shutdown behavior against its own API.
