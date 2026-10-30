# Logs Interceptor

Optional major review candidate: `logs-interceptor@3.0.0`, unpublished. This is not an alias for
`elven-logs-interceptor`. See [source recovery](RECOVERY.md) and
[security changes and limitations](AUDIT-LEGACY.md). Legacy LOGS_INTERCEPTOR_*
configuration is retained. Runtime minimum for this revised optional major is
Node 22.0.0. Use currently patched maintained22/24/26 releases; exact22.0.0 is a
compatibility-floor test, not a security recommendation. The old18.17 candidate
is withdrawn by the CPU finding and remains immutable historical evidence.

Official [Node integration guide](https://docs.elven.works/elven-observability/integracao-e-instrumentacao/javascript/instrumentacao-node.js-com-elven-observability.html)
and [documentation source](https://github.com/elvenworks-ps/docs.elven.works).
Do not substitute the renamed package without an explicit environment/API and
transport migration. No release workflow for this branch has been dispatched.

## Optional Migration From 2.x

The public baseline is `logs-interceptor@2.1.6`. The withdrawn, unpublished
2.1.7 review archive is historical evidence, not an upgrade recommendation.
Applications using `^2` do not automatically receive3.0.0. This candidate remains
on hold for fresh independent source/runtime review, registry authorization and
matching public-source/provenance approval. No package has been published here.

After an approved3.0.0 publication, upgrading requires an explicit dependency
change to3.x and Node>=22.0.0. Promotion is next-tag-only and parent-authorized.
Applications below that floor must not upgrade;
do not bypass engine checks. The package name, root CJS/ESM API, legacy
`LOGS_INTERCEPTOR_*` environment, Loki JSON/protobuf transports, compression
choices and Winston/Morgan/Node-RED entry points are not renamed or silently
replaced by the modern `elven-logs-interceptor` package.

### Pattern Policy Migration

The source-owned matcher core is copied exactly from reviewed modern commit
`33f98323500aa259209fb7c10f034b8579aa52b6`, not a separately invented engine.
Only its exact14 internally owned, certified default/builtin rules use native
matching. Other caller rules use re2js2.9.1 with an AST semantic adapter; no
arbitrary native RegExp fallback or heuristic safety certificate is used.

RegExp[] input APIs remain, but rules are declarative snapshots at initialization.
Changing a caller array or RegExp later does not update an initialized logger;
call init() with the new configuration. Caller lastIndex is no longer modified.
Boolean matching starts at zero; this is not a native exec/indices/replacer API.

Unsupported lookaround/backreferences, Unicode properties/v sets and other
unsupported flag/input combinations reject startup with fixed value-free codes.
Unsupported live input/work exhaustion masks affected privacy decisions and
drops failed selectors, with privacyCodes visible in health. It does not export
raw data, print the pattern or use native matching as a fallback. Explicit
sanitize:false retains the privacy opt-out; selectors still use the safe policy.

The revised limits are32 caller rules per role,256 source UTF16 units (previous
candidate512),256 AST nodes/depth16, bounded expansion/instructions/cache,64Ki
distinct input units/record,2048 memoized values and65536 rule calls. These can
reject configurations or input accepted by2.x; see [matcher migration and
gates](AUDIT-MATCHER.md). No full JavaScript-RegExp equivalence, universal CPU/RSS
bound or whole-application overhead guarantee is claimed.

Selectors keep the legacy order: they inspect the already truncated/redacted
message. Keys use explicit sensitivity rules; values also use builtin masks.
Valid hex trace/span IDs retain generic PAN exemption, while explicit sensitive
rules and matcher failure still take precedence. Default indexed IDs stay on.

Indexed `trace_id`, `span_id` and `request_id` selectors remain enabled by
default, as in2.1.6. Known-sensitive values still follow the configured
sanitization policy. To explicitly reduce correlation-label cardinality:

```js
init({
  appName: 'my-service',
  transport: { url: 'http://loki:3100/loki/api/v1/push', tenantId: 'my-tenant' },
  indexCorrelationIds: false,
});
```

The equivalent preload setting is
`LOGS_INTERCEPTOR_INDEX_CORRELATION_IDS=false`. In that mode, automatic/dynamic
correlation labels are not indexed: selectors such as `{request_id="..."}` for
those IDs stop matching. Parse the retained `requestId`, `traceId` and `spanId`
fields populated by tracing/dynamic callbacks from the JSON log line instead.
Explicit static labels remain configured, including any static correlation
labels; remove those explicitly if desired. Other user-selected dynamic labels
can still create high cardinality. This mode is opt-in, not a universal
cardinality guarantee.

Application Workers retain automatic initialization. Only SDK-owned WorkerPool
threads suppress internal preload/auto-init; this does not change the main
process environment. The bounded buffer intentionally evicts old entries under
pressure. `getMetrics().logsDropped` counts those evictions plus filtered logs,
not every possible transport/backend loss. Raw preserved console output is
still outside exported-data sanitization.

Winston completion callbacks retain their old synchronous behavior. Ordinary
`logged` notifications remain deferred; at128 pending notifications the older
batch is emitted synchronously to bound retention without omitting events.
Application-provided event handlers are not sandboxed. See
[the follow-up](AUDIT-LEGACY-FOLLOWUP.md) for qualification and remaining gates.

[![npm version](https://img.shields.io/npm/v/logs-interceptor.svg)](https://www.npmjs.com/package/logs-interceptor)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Logs Interceptor** captures Console, Winston and Morgan logs for [Grafana Loki](https://grafana.com/oss/loki/). Overhead and delivery depend on workload, configuration and collector availability.

## Why use this?

*   Bounded Worker tasks and asynchronous batches; no universal overhead guarantee.
*   Protobuf + Snappy, Gzip and Brotli; compression savings vary by payload.
*   Circuit breaker and optional passive file DLQ; neither guarantees zero loss or automatic replay.
*   **🧠 Intelligent**: Automatically intercepts `console.log` and extracts structured metadata.
*   **🔌 Universal**: Works with any Node.js framework (Express, NestJS, Fastify).

---

## Installation

The commands below install the currently public package, not this unpublished
major candidate. Use an explicit3.x version only after its approved release.

```bash
npm install logs-interceptor
# or
yarn add logs-interceptor
```

---

## Usage Guide

### 1. The "Zero-Code" Way (Docker / Kubernetes) 🐳

**Best for**: Legacy apps, Microservices, DevOps-led implementation.
**Concept**: Add the library + environment variables. No code changes required.

```dockerfile
# Dockerfile
RUN npm install logs-interceptor

# 1. Configure via Environment
ENV LOGS_INTERCEPTOR_APP_NAME="billing-service"
ENV LOGS_INTERCEPTOR_URL="http://loki:3100/loki/api/v1/push"
ENV LOGS_INTERCEPTOR_TENANT_ID="production"

# 2. 🔥 THE MAGIC: Preload the library before your app starts
ENV NODE_OPTIONS="--require logs-interceptor/preload"

CMD ["node", "app.js"]
```

**Supported Variables for Tuning:**

| Variable | Description | Default |
|----------|-------------|---------|
| `LOGS_INTERCEPTOR_APP_NAME` | Service Name | **Required** |
| `LOGS_INTERCEPTOR_URL` | Loki URL | **Required** |
| `LOGS_INTERCEPTOR_TENANT_ID` | Tenant ID | **Required** |
| `LOGS_INTERCEPTOR_AUTH_TOKEN` | Bearer Token | `undefined` |
| `LOGS_INTERCEPTOR_COMPRESSION` | `snappy`, `gzip` | `gzip` |
| `LOGS_INTERCEPTOR_BUFFER_SIZE` | Logs per batch | `100` |
| `LOGS_INTERCEPTOR_FLUSH_INTERVAL` | Max delay (ms) | `5000` |
| `LOGS_INTERCEPTOR_MAX_MEMORY_MB` | Mem Limit (MB) | `50` |
| `LOGS_INTERCEPTOR_USE_WORKERS` | Enable Workers | `true` |
| `LOGS_INTERCEPTOR_MAX_WORKERS` | Worker Count | `2` |
| `LOGS_INTERCEPTOR_INDEX_CORRELATION_IDS` | Keep indexed trace/span/request selectors; `false` explicitly removes them | `true` |
| `LOGS_INTERCEPTOR_CIRCUIT_BREAKER_ENABLED`| Circuit Breaker | `true` |
| `LOGS_INTERCEPTOR_DLQ_ENABLED` | Dead Letter Queue | `false` |
| `LOGS_INTERCEPTOR_DLQ_TYPE` | DLQ Type (`file`) | `file` |
| `LOGS_INTERCEPTOR_LOG_LEVEL` | Levels (`info,warn`) | `all` |

---

### 2. The "Standard" Way (Programmatic) 💻

**Best for**: New applications, granular control, custom events.

```typescript
import { init, logger } from 'logs-interceptor';

// 1. Initialize at the start of your app
init({
  appName: 'my-service',
  interceptConsole: true, // 👈 Captures console.log automatically!
  transport: {
    url: 'http://loki:3100/loki/api/v1/push',
    tenantId: 'my-tenant',
    compression: 'gzip',
  },
  deadLetterQueue: {
    enabled: true,
    type: 'file' // Saves logs to disk if Loki is down
  }
});

// 2. Use Console (Automatically intercepted)
console.log('Server started', { port: 3000 });
console.error('Database connection failed', new Error('Connection timeout'));

// 3. OR Use the Logger API directly (Better performance)
logger.info('User logged in', { userId: '123', plan: 'premium' });
logger.warn('Rate limit approaching', { used: 95, limit: 100 });
logger.error('Payment failed', { amount: 99.99, error: 'Insufficient funds' });
```

---

### 3. The "High-Scale" Way (Extreme Performance) 🚀

**Best for**: High-throughput systems (1000+ logs/sec).
**Features**: Protobuf, Snappy, Worker Threads, Connection Pooling.

```typescript
init({
  appName: 'high-scale-service',
  transport: {
    url: process.env.LOKI_URL,
    tenantId: 'production',
    
    // 🚀 Performance Tuning
    compression: 'snappy',       // Native C++ compression
    useWorkers: true,            // Move compression to background thread
    maxWorkers: 4,               // Parallel processing
    enableConnectionPooling: true,
    maxSockets: 100              // Concurrent HTTP connections
  },
  buffer: {
    maxSize: 2000,               // Send large batches
    flushInterval: 2000,         // Wait to fill batches
  }
});
```

---

## Features In-Depth

### 🧠 Console Interception
Don't refactor your legacy code. Just enable `interceptConsole: true` and your standard logs become structured events.
```typescript
// Input
console.log('Order created', { id: 10, total: 50 });

// Output (in Loki)
// level="info" msg="Order created" context={"id": 10, "total": 50}
```

### 📊 Event Tracking
Separate operational logs from business analytics.
```typescript
logger.trackEvent('purchase_completed', {
  value: 49.99,
  currency: 'USD',
  items: 3
});
```

### 🛡️ Unbreakable Resilience
We take data loss seriously.
1.  **Circuit Breaker**: Stops flooding Loki if it's down.
2.  **Dead Letter Queue (DLQ)**: Automatically saves failed logs to the disk (`./.logs-dlq`).
3.  **Automatic Retry**: When the network recovers, you can replay these logs.

---

## Configuration Reference

For a complete copy-pasteable example of **EVERY** option, see [`examples/full-config-reference.ts`](examples/full-config-reference.ts).

### Core Options
| Option | Default | Description |
|--------|---------|-------------|
| `appName` | **Required** | Identifier for your service. |
| `version` | `'1.0.0'` | App version attached to logs. |
| `interceptConsole` | `false` | **Highly Recommended**. Captures `console.log/error`. |
| `silentErrors` | `false` | If true, suppresses library internal errors. |

### Transport (Connectivity)
| Option | Default | Description |
|--------|---------|-------------|
| `transport.url` | **Required** | Loki Push API URL. |
| `transport.tenantId` | **Required** | Tenant ID (X-Scope-OrgID). |
| `transport.compression` | `'gzip'` | `gzip` (universal), `snappy` (fastest). |
| `transport.useWorkers` | `true` | Use worker threads for CPU-intensive tasks. |

### Buffering (Batching)
| Option | Default | Description |
|--------|---------|-------------|
| `buffer.maxSize` | `100` | Logs per batch. |
| `buffer.flushInterval` | `5000` | Max delay (ms) before sending. |
| `buffer.maxMemoryMB` | `50` | Buffer safety limit (MB). |

---

## Integrations

### Winston
```typescript
import winston from 'winston';
import { getLogger, WinstonTransport } from 'logs-interceptor';
// Initialize logs-interceptor once before constructing the host transport.
const logger = winston.createLogger({
  transports: [new WinstonTransport({ logger: getLogger() })]
});
```

### Morgan (HTTP)
```typescript
import morgan from 'morgan';
import { getLogger, MorganAdapter } from 'logs-interceptor';
app.use(morgan('combined', { stream: MorganAdapter.createStream(getLogger()) }));
```

Winston and Morgan are optional application-owned integrations; install their
host libraries in the application when using those adapters.

---

## License

MIT
