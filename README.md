# Logs Interceptor

[![npm version](https://img.shields.io/npm/v/logs-interceptor.svg)](https://www.npmjs.com/package/logs-interceptor)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Logs Interceptor** is a battle-hardened, high-performance logging client for Node.js. It intercepts logs (Console, Winston, Morgan) and ships them efficiently to [Grafana Loki](https://grafana.com/oss/loki/).

## Why use this?

*   **⚡ Zero Blocking**: Uses Worker Threads and async batching. Your API latency won't spike because of logging.
*   **📉 Smart Compression**: Supports **Protobuf + Snappy** (80% less bandwidth) or Gzip (compatibility).
*   **🛡️ Data Loss Prevention**: Built-in **Circuit Breaker** and **File-based Dead Letter Queue (DLQ)**.
*   **🧠 Intelligent**: Automatically intercepts `console.log` and extracts structured metadata.
*   **🔌 Universal**: Works with any Node.js framework (Express, NestJS, Fastify).

---

## Installation

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
import { WinstonTransport } from 'logs-interceptor';
const logger = winston.createLogger({
  transports: [ new WinstonTransport() ]
});
```

### Morgan (HTTP)
```typescript
import { MorganAdapter } from 'logs-interceptor';
app.use(MorganAdapter.create('combined'));
```

---

## License

MIT
