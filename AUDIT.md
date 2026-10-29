# Logs Audit Candidate 1.1.1

Review candidate only. No merge, npm publication, deployment or credential change
was performed. `elven-logs-interceptor` remains the package identity. The separate
legacy `logs-interceptor@2.1.6` has not been republished, renamed or silently aliased.

## Changes

- OTel 2.12.x / 0.223.x and a patched Undici 6.x floor, without force overrides.
- Bounded detached snapshots before buffering, including unsanitized mode;
  Buffer summaries, depth/node/text limits, deterministic regex evaluation and
  conservative custom-regex validation. Original stdout preservation is not DLP.
- Nested memory accounting; correlation IDs outside automatic Loki stream
  labels; bounded Worker queue, clone/exit/error/timeout cleanup and idle unref.
- Internal Workers strip NODE_OPTIONS. Main-thread auto-init is independently
  gated, including inherited LOGS_AUTO_INIT. Console wrappers restore only their
  own hooks and exclude export diagnostics even without an OTel context manager.
- Bounded retry backoff, cancellable retry sleeps, finite shutdown drain,
  request deadlines, limited Loki response bodies and explicit agent cleanup.
- Exact OTLP signal endpoint support, safe DLQ oversized-entry handling and
  private new files, Winston callback backpressure and Node-RED pass-through.
- Correct repository metadata, release preflight and maintained Node CI matrix.

## Verification

Thirty-seven Jest tests passed, including actual local gzip OTLP export and
custom endpoint routing. Build and lint passed (test-double/console warnings
remain warnings). Clean packed CJS/ESM/preload consumers work on Node
18/20/22/24/26. Actual Loki JSON and protobuf exports were decoded for none,
gzip, Brotli and Snappy, with and without real Workers. Offline, 429, trickle,
large messages/responses, CPU/RSS samples and thread saturation were exercised.
The clean production graph has zero npm advisories at the audit timestamp.

Independent review found static labels bypassed the log filter when copied
directly into OTLP Resource. A shared detached, bounded label policy now covers
Resource defaults/static labels and record labels using the configured patterns
and sanitize flag. Four regressions decode Resource and record attributes and
scan the entire protobuf payload, including static password/email, custom
patterns, explicit sanitize:false, frozen inputs and string-valued truncation
sentinels. The pre-fix tests failed on 0e237960; its candidate archive is withdrawn
from release consideration. This correction requires renewed review and CI.

## Limitations

The development audit retains the deepmerge advisory through Jest; production
consumers do not install that graph. No Jest downgrade was used to hide it.
safe-regex2 is a heuristic, not a sandbox for hostile configuration. Memory
accounting is not an RSS ceiling; original application objects/stdout, native
compression, async context and DLQ use additional memory. File DLQ is plaintext,
single-process and not a replay/durability guarantee. Node-RED adapter behavior
was mocked, not qualified in a full Node-RED deployment. Real multi-process
DLQ sharing, long soak, Windows/Linux native packaging and production outcomes
remain unqualified. Node 18/20 are EOL despite compatibility smoke success.

Legacy runtime probes reproduced unbounded stream cardinality and a mismatched
gzip header for a small preload log. Migration must explicitly translate the
old LOGS_INTERCEPTOR_* environment and verify transport behavior. A clean npm
scan of the legacy fresh resolver does not remediate its shipped code defects.

Full private evidence is in the coordinating audit's `evidence/node/report.json`
and `report.md`, including tarball hashes, versions, source lines and all findings.

Primary references:
- https://github.com/nodejs/undici/security/advisories/GHSA-2m5v-pch6-74hx
- https://github.com/nodejs/undici/security/advisories/GHSA-qrxm-fqhp-jwvm
- https://nodejs.org/en/about/previous-releases
