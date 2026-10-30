# Elven Logs Interceptor

Optional major-line candidate `2.0.1`, UNPUBLISHED and not yet qualified. Historical
`2.0.0` audit archives are immutable and are not replaced. Promotion is coordinated separately
and is restricted to the `next` dist-tag, not `latest`. Published `1.1.1` remains
immutable; its accepted custom RegExp configuration can block the event loop.
Official [Node.js integration guide](https://docs.elven.works/elven-observability/integracao-e-instrumentacao/javascript/instrumentacao-node.js-com-elven-observability.html)
and [documentation source](https://github.com/elvenworks-ps/docs.elven.works).

## Compatibility And Limits

This optional major requires Node `>=22.0.0`. The actual 22.0.0 binary has passed
the production tarball consumer, real HTTP OTLP export, Winston callbacks,
restart, preload, fork and Worker checks; newer 22.x alone is not minimum proof.
Use a current security-patched Node 22/24/26 in production, not the historical
minimum binary. Node 18/20 are EOL; see [Node releases](https://nodejs.org/en/about/previous-releases).
The OTel generation remains `2.12.x` / `0.223.x`, not 3.x. CJS and native ESM
imports remain supported; the package itself remains CommonJS.

`logs-interceptor@2.1.6` is a separate legacy npm identity, not an alias silently
redirected by this package. Audit its API/config and migrate explicitly; the
larger version number does not mean it is newer than `elven-logs-interceptor`.

Graphs are copied before queueing, without invoking getters or `toJSON`.
Snapshots use shared limits of 500 nodes, depth 8, 100 array elements and a
text budget; Buffer/typed-array payloads become size summaries. Console capture
limits 32 arguments and 8192 characters; original console output, when enabled,
still receives the original arguments and is NOT sanitized by this library.
Disable preservation or sanitize at the application source for stdout privacy.
Custom matchers use the bounded nonbacktracking adapter described below, not
safe-regex heuristics or a timeout around JavaScript RegExp.

Buffer memory accounting includes nested payloads but is an estimate, not a
process RSS limit. Defaults retain 100 entries, 2 active and 2 queued batches;
DLQ, retry, serialization, native compression and Workers use additional memory.
Config rejects non-finite values and extreme queue, payload, timeout and worker
sizes. Retries are capped to 5; local base backoff is at most30seconds plus
0..249ms jitter. Loki requests have a
whole-request deadline and a 64 KiB response budget. Export operations suppress
tracing to avoid tracing their own HTTP requests. Correlation IDs remain log
fields instead of automatically creating one Loki stream per request. Custom
dynamic labels still require a low-cardinality value set.
`transport.maxRetries`/`retryDelay` control the transport decorator's retries.
OTLP additionally uses the upstream exporter's bounded retries within each export
deadline. These are not identical retry algorithms or delivery guarantees. The
decorator's total send budget below also bounds retries of an OTLP export. Other
upstream retry options are not configured by those local
settings; the 429 consumer control observes up to six attempts including the
initial request even when the Elven `maxRetries` value is zero.

### Backpressure And Send Budgets

Loki JSON and protobuf honor `Retry-After` on retryable429/5xx responses. Valid
nonnegative seconds and HTTP dates are converted to a monotonic minimum at header
receipt. Separate valid fields use the greatest floor, including when another
field is invalid; date commas are never split. Parsing examines at most8fields
of128characters each. Oversized, malformed or ambiguous fields are ignored with
fixed `ELVEN_INVALID_RETRY_AFTER` diagnostics, rate-limited per transport to10s;
they never permanently disable delivery. Ordinary local backoff still applies.
This bounded receiver policy follows the [HTTP date/delay forms](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.2.3)
with an explicit conservative maximum for repeated valid fields.

`transport.sendTimeoutMillis` is a NEW total operation budget: default30000ms,
configurable1..60000ms, including retries, backpressure waits and active attempts.
A valid floor beyond the current operation's budget causes immediate fixed
`ELVEN_RETRY_AFTER_DECLINED`, not an early retry or a60-second sleep. The shared
floor belongs only to that owned transport, applies to concurrent/new sends even
with `maxRetries:0`, and expires naturally. A syntactically valid positive delay
too large to represent instead reports `ELVEN_RETRY_AFTER_UNREPRESENTABLE` and
requires explicit reinitialization; no infinite or overflowed timer is created.
Suppressed attempts do not create new circuit-breaker failures. Health reports
backpressure separately from the actual breaker state. HTTP dates require a
reasonably synchronized local UTC clock; this is not a remote clock-skew oracle.

Factory-owned Loki JSON/protobuf sends recheck the shared floor, operation
deadline and cancellation AFTER asynchronous Worker/codec preparation. The final
fresh eligibility check and request invocation run in the same synchronous turn,
including after an awaited wait; no separate permission token can go stale in a
queued microtask. This does not serialize independent requests. Requests admitted
before a new floor are not retroactively recalled. Deep-imported raw codec classes
do not own the decorator's cross-send retry policy; use the public logger/factory
pipeline for these guarantees. OTLP's upstream retry policy remains distinct.

Historical audit artifact fd9d484/2f76 is rejected: an actual public Brotli pair
created a60-record request85.140875ms AFTER another call publicly acknowledged
a60-second floor. The new post-preparation regression keeps the exact fixture,
privacy and concurrency; it must decline both batches before A request creation.
With DLQ disabled this means61 unacknowledged/unretained entries, not zero loss.
Old v2 harness failure remains UNKNOWN; it is not retroactively qualified.

Cancellation is per operation: it aborts its network request or queued/active
Worker task, not another request or the shared transport. Shutdown cancels all
owned operations. Timers cannot preempt synchronous JavaScript or native work;
already-running bounded native Snappy compression is awaited, then abort is
checked before any network request. This is not a hard real-time wall-clock SLA.
The native zlib stream is closed before cancellation settles. Existing capture,
privacy, queue, pattern and Worker caps are unchanged.

Migration: `logsProcessed` counts admission, not acknowledged delivery, and
`logsDropped` retains its admission/backlog meaning. New `failedSendEntries`
counts terminal unacknowledged batches, `dlqEnqueuedEntries` counts their entries
accepted by the optional DLQ, and `unretainedSendEntries` counts the remainder.
DLQ acceptance is cumulative, not current queue size or durability; entries may
be evicted even within one batch. `unretainedSendEntries` concerns entries never
accepted by that failure handler, not later DLQ eviction.
`backpressureDeclines` and `deadlineExceeded` count operation outcomes. Existing
`droppedByDlq` includes rejection/eviction and overlaps these counts, so do not
sum all buckets as distinct losses. A failed ACK does not prove the server did
not ingest a request; retries may duplicate records and the DLQ is not an ACK.

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
# After separate approval and publication to next; not available yet:
npm install elven-logs-interceptor@next
```

Do not change a production dependency from `1.x` until its runtime and custom
matcher configuration have passed the major migration checks below.

## Major 2 Privacy Migration

The public logging, lifecycle, integrations and configuration names are retained.
These are intentional breaking boundaries, hence a separate opt-in major:

- Node 18/20 are excluded; the package floor is now 22.0.0.
- Custom rules use pinned [RE2JS 2.9.1](https://github.com/le0pard/re2js), with an
  AST-normalized JavaScript subset. No arbitrary custom rule falls back to JS
  RegExp. Only exact, fixed internal default rules use a certified native path;
  the normal default pipeline does not load RE2JS or the parser.
  Native rules still validate malformed UTF-16 before matching, with the same
  fail-closed behavior and record budgets as generic rules.
- Unsupported configuration rejects `init()` with a fixed value-free code,
  before opening the pipeline or retiring an existing runtime. Diagnostics never
  include pattern source, sample text, labels or context values.
- Unsupported live input or an exhausted record budget masks the affected and
  subsequent privacy values and drops selectors when necessary. Business logging
  does not throw; `getHealth().privacyDiagnostics` exposes fixed codes and marks
  health degraded. There is no raw-data failure fallback.
- `sanitize: false` remains an explicit privacy opt-out, not a recovery mechanism.
  Selectors are still checked. A supplied `sensitivePatterns` list replaces the
  default key rules, as before; built-in value detectors still apply when enabled.
- Matching continues to mask whole sensitive values, not rewrite fragments.
  Schema keys remain schema keys; never put personal data or credentials in keys,
  attribute names, destinations, or correlation identifiers.

Supported controls include ordinary ASCII case folding, JavaScript whitespace
(including NBSP and BOM), Unicode literals, `u` code-point matching, dot/`s`,
LF multiline anchors, and deterministic boolean `g`/`y` matching without mutating
the caller's `lastIndex`. The `d` flag has no observable indices in this boolean
API. Normal captured and named static replacements are tested in the portable
adapter, but no public replacement callback API is added.

Explicit exclusions: lookahead/lookbehind, backreferences, Unicode property
escapes, `v` sets, non-ASCII case folding outside the documented ASCII/Kelvin/long-s
subset, and `iu` word boundaries. Live lone surrogates, non-`u` broad/empty atoms
on astral text, and multiline anchors on CR/LS/PS fail closed. Internal replacement
callbacks, sticky replacement, repeated captures and fixed-native-plan replacement
are rejected. Check every custom rule before migration; do not cast around a
rejection or disable sanitization to claim compatibility.

One shared policy covers message selectors, messages, context keys/values,
dynamic/static record labels and OTLP Resource labels. Record scopes share work
and input budgets, and are cleared after each event; destroy closes the policy.

| Budget | Limit |
| --- | --- |
| Custom rules | 32 per role; 256 source UTF-16 units each |
| AST | 256 nodes, depth 16, 16 captures per rule |
| Expanded cost | 1024 per rule; 4096 total |
| Normalized source | 8192 units per rule; 32768 total |
| Combined matcher programs | 4096 instructions per rule; 32768 total |
| DFA cache | 65536 accounted bytes per custom rule; at most 4587520 total |
| Record input | 65536 UTF-16 units per value and distinct record strings; 2048 values |
| Record work | 65536 rule calls; 33554432 weighted work units |
| Internal replacement | 128 matches, 1024 replacement units, 65536 output units |

Compile, cache and work budgets are engineering limits, not hard process RSS or
CPU-time guarantees. Snapshot and matcher limits are separate: increasing
`maxMessageLength`/`maxContextBytes` does not increase the privacy work envelope.
Measure the actual application and export workload. Isolated matcher timings do
not qualify whole-application overhead, nor waive any SDK performance release gate.

Snapshots materialize bounded UTF-16 code units before matching and queueing,
including already-short borrowed string views. Slicing or cloning only the map
does not establish backing-storage ownership. Lone surrogates are preserved for
the privacy policy to reject, not converted to U+FFFD first. Correlation identifiers
are copied with an8192-unit limit and an explicit truncation marker for oversized
invalid values; valid trace/span IDs and default dimensions are unchanged.

The optional2.x configuration snapshot accepts at most16384 UTF-16 units per
string,65536 total units,512 values,64 keys/items per container and depth8.
Oversized/cyclic/accessor configuration fails with fixed
`ELVEN_CONFIG_INPUT_BUDGET` before replacing the active logger. Transport URLs,
headers and credentials are never silently truncated. Maps/RegExp descriptors
are owned copies; caller objects/state stay unchanged. Dynamic-label providers
remain administrator callbacks: their execution and deliberately retained
closure/application graphs are not covered by queue-memory bounds. Async caller
scope lifetime and caller-held originals are likewise not owned-queue storage.

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
The upstream OTLP exporter merges ambient OTLP headers with explicit headers;
changing the destination alone does not clear inherited credentials. Configure
destination/header ownership at application startup; this library does not mutate
global environment variables. HTTP(S) collector/gateway URLs are supported;
`HTTP_PROXY`/`HTTPS_PROXY` are not a forward-proxy configuration API here.

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
- Application logging does not await network I/O; bounded synchronous snapshot
  and redaction work still consumes CPU

## License

MIT

## Maintainer Release Gates

Source tests use compiled TypeScript and the standard `node:test` / `node:assert`
runner, serialized for global logger, console, environment and provider state.
`npm test` includes the original 67 expanded cases plus detachment regressions;
`npm run test:port` checks the
original title/assertion inventory (351 executed assertions, 144 source sites)
and separate numeric, rejection, cross-realm and mock restoration controls.
The limited helpers preserve the used Jest operator contracts, including
number/bigint type checks and Error/throwing-function promise rejection matching. The original
Jest configuration remains historical, not active; Jest and its development
dependency tree are no longer required. `npm run test:watch` uses TypeScript's
watch compiler and serial reruns. Generated `.test-dist` is not packaged.

This removes the affected development dependency path for
[CVE-2026-93753 / GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4),
not the upstream vulnerability itself or already-installed older package graphs.
The advisory has no patched deepmerge version. Production and full-development
audits run separately; a clean audit is not a claim that all vulnerabilities are
known or absent.

The manual `.github/workflows/release.yml` accepts only `main`, an exact current
SHA, `2.x` version and `publish elven-logs-interceptor@VERSION next` confirmation.
It requires successful Node 22/24/26 and actual minimum 22.0.0 main-push CI for
that SHA, a public matching repository, separate clean production/development
audits and the validated
archive hash. `next` is enforced in metadata, guard and publish command; `latest`
is not promoted. Only the final hosted publish
job receives `NPM_TOKEN`; `id-token: write` and `--provenance` remain mandatory.
There are no push/tag publication triggers and no provenance fallback.

An authorized maintainer must configure `NPM_TOKEN` in this package's matching
GitHub repository before dispatch. No credential is shipped in this package;
this candidate's workflow has not been dispatched. Credential provisioning is
separate, and trusted-publisher configuration is not assumed. A coordinator token
in another repository does not establish this package's provenance. This
2.x workflow candidate was prepared, not dispatched. See the [npm provenance requirements](https://docs.npmjs.com/generating-provenance-statements/).

The legacy `logs-interceptor@2.1.6` is a separate identity, not an npm alias.
Do not substitute it without translating `LOGS_INTERCEPTOR_*` configuration and
qualifying the transport, preload and shutdown behavior against its own API.
