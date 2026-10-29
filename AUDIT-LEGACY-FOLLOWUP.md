# Optional Legacy 3.0.0 Source Follow-up

2026-10-29. This is the distinct `logs-interceptor` package, not an alias for
`elven-logs-interceptor`. Human-approved optional major policy sets the runtime
minimum to Node18.17.0 without downgrading undici6.29.1. Existing^2 users are not
automatically upgraded. No registry publication, mirror, merge, account,
credential or target-application operation is authorized here.

## Preserved Historical Evidence

- Rejected source: f7c6a48a9a672ec4a19c09a0132c41ed5d5e4197.
- Its unpublished2.1.7 hosted archive SHA256:
  acc8ef3cc6595bc877a48ac73f0e8609a14292590b9e9707407bbe20fb861a97.
- The pre-fix independent LR01-05 review remains immutable outside this source
  tree. This document supersedes neither those observations nor their receipts.
- Recovered2.1.6 baseline:14b3bf06651cd6994f0889299529a84e4bfeb0e5.
  The105/105 normalized runtime/declaration/preload reconciliation remains a
  historical recovery proof, not blanket acceptance of this new major.

## Scoped Remediations

- LR01: restores the original synchronous Winston completion callback. A single
  scheduled notification batch retains at most128 pending `logged` entries;
  pressure emits the older batch early rather than dropping notifications or
  building one immediate per call. Native Winston3.19.0 processes all1000
  ordinary calls followed by `end()` without `write after end`; all1000 logged
  events are observed. Normal notification deferral remains. Earlier delivery
  at the pressure bound is explicit; arbitrary application listeners are not
  sandboxed and no universal host-Writable memory bound is claimed.
- LR02: timer and immediate flush demand re-arm when a coalesced in-flight
  send leaves entries pending. One sender remains active. Quiet-tail fixtures
  cover success and500/following-success recovery, normal and full-buffer
  paths,20 coalesced flush calls, and no subsequent retry loop without new data.
- LR03: indexed trace_id/span_id/request_id selectors are DEFAULT again.
  `indexCorrelationIds:false` or LOGS_INTERCEPTOR_INDEX_CORRELATION_IDS=false
  explicitly omits automatic/dynamic correlation labels, not JSON correlation
  fields or caller-configured static labels. Other dynamic labels remain
  caller-controlled and can have high cardinality. Known-sensitive values are
  sanitized in labels and correlation fields; valid hexadecimal trace/span IDs
  are not misclassified as payment-card fields. Explicit sensitive patterns
  still override that typed-ID classification. Raw preserved stdout remains
  outside this exported-data policy.
- LR04: only SDK-owned WorkerPool threads receive an internal suppression tag;
  they also retain empty execArgv and stripped NODE_OPTIONS. Application Workers
  keep root/preload auto-initialization and actual exports. Public WorkerPool
  eager-start behavior is unchanged.100 tasks with2 workers+4 queued settle6
  accepted/94 bounded rejections. Preload coordinates its root import to create
  one configured logger, not a transient default logger followed by replacement.
- LR05: addressed by the explicitly approved optional major/runtime policy,
  not by claiming an unchanged effective floor for2.x or restoring vulnerable
  undici. Node18/20 remain EOL compatibility profiles, not security support.
- The existing public logsDropped metric now includes bounded count/memory
  evictions plus filtered logs. The1000-entry/8-slot fixture reports992 evictions
  plus one filtered log =993, without exporter diagnostics or metric noise.
  This is not complete transport/backend loss attribution or durable delivery.

## Assertion-preserving Test Port And Graph

The original src/__tests__/integration.test.ts and jest.config.js remain
unchanged as historical references. tests/legacy-integration-ported.test.cjs
ports all12 titles and17 assertions to existing node:test patterns. The only
destination change replaces external DNS/network failure with loopback503;
each case awaits owned cleanup. tests/jest-port-inventory.cjs verifies the
one-to-one title/assertion mapping. No Jest mocks existed to emulate or omit.

Jest, ts-jest and their types are removed from the active development graph.
Neither the new lock nor the clean installed graph contains deepmerge. Its
upstream CVE-2026-93753 remains unfixed: this removes our development path, not
the upstream vulnerability. [CNA advisory](https://www.vulncheck.com/advisories/deepmerge-through-4.3.1-prototype-poisoning-via-mergeobject),
[upstream report](https://github.com/TehShrike/deepmerge/issues/273), checked2026-10-29.
Anonymous registry bulk advisory receipts are dated package/version matches,
not zero-CVE or whole-source guarantees. Existing ESLint9 deprecation and
nonfatal source warnings are not hidden or represented as current support.

Recursive lint now quotes the source glob instead of relying on shell depth.
Behavior-neutral const/case-block/regex syntax and lexical Node-RED callback
changes fix newly covered errors without disabling rules or dropping tests.

## Qualification And Receipts

The focused suite contains30 cases:12 retained native regressions,12 ported
historical cases, and6 independent-review/drop-count regressions. Real local
JSON/protobuf+Snappy/gzip/Brotli requests, static/context/correlation privacy,
owned/application Workers, native Winston, console/signals, bounded responses,
retries, DLQ and mocked Node-RED are included. Synthetic OTel context in the
application-Worker fixture is explicitly a test context, not a real SDK matrix.

scripts/qualify-major.cjs records macOS ARM64 profiles18.17.0 exact,20,22,24,26
under .rebuild/major3-qualification/. The official18.17.0 binary is checked
against its HTTPS SHASUMS256; a release-signature verification is not claimed.
The18/20 profiles are compatibility-only. The initial global-hook port teardown
and transient-preload-instance failures are retained as rejected diagnostics;
per-case owned teardown and single preload initialization fix those paths
without force-exit or skipped assertions.

Fresh exact-head Linux CI includes maintained22/24/26 build/test/pack consumers
and separate18.17.0/20 EOL runtime compatibility jobs built on a maintained host.
tests/pack-receipt.cjs requires clean committed3.0.0 source and records source,
lock and archive hashes. tests/packed-consumer.cjs creates a new isolated
consumer, forwards no credential environment, checks every installed archive
file byte-for-byte, verifies strict installed declarations and executes all30 cases.
Artifacts use release/3.0.0/<source-commit>/ without overwriting old2.1.7
archives or receipts. It never reuses prior same-version
consumer directories. Hosted receipts/artifacts, not an older local tarball,
define the exact new candidate identity.

## Promotion Holds

- Fresh exact-head CI and its artifact must pass; consult the current run, not
  the old40944588881 success for rejected f7c6a48.
- A different owner must independently replay this new source/archive, including
  SDK coinstallation and original selector/API baseline fixtures.
- Registry ownership/authentication and matching reviewed public-source
  provenance remain unresolved parent-owned gates. There is no publisher
  authority delegated to this source owner and no credential/account action.
- Long soak, customer acceptance, browser/edge, Windows native Snappy,
  arbitrary foreign instrumentation, hostile callbacks/Proxy traps, shared
  file DLQ and universal overhead/RSS/backend-ingestion guarantees are unproven.

README.md contains the explicit optional2.x-to3.x migration and low-cardinality
query tradeoff. No modern package main, canonical plugin, central docs, AWS
layer/ZIP/ARN or deployment was changed by this work.
