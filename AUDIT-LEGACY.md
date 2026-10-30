# Legacy 3.0.0 Optional Major Review Candidate

Unpublished optional major for the distinct `logs-interceptor` identity.
The historical2.1.7 archive and pre-fix independent review remain unchanged;
they are not this new source/artifact or an accepted release. Existing^2 users
are not automatically upgraded. The revised approved minimum is Node22.0.0,
with undici6.29.1 retained and no vulnerable downgrade. Registry authorization,
fresh exact-head CI/artifact evidence and independent review remain gates.
This branch must not replace modern main or be published by its main-only
modern-package workflow. See RECOVERY.md for the 105/105 rebuilt runtime and
declaration correspondence before security edits and the stale registry gitHead.

Preserved: public init/getLogger/logger/destroy APIs, old LOGS_INTERCEPTOR_*
environment, Loki JSON and protobuf/Snappy, compression modes, and Node-RED/
Winston/Morgan entry points. No LOGS_* rename, OTLP defaults or package alias.

Backport changes:
- bounded detached graphs before application context spread and serialization;
  no ordinary getter/toJSON execution; finite buffer memory/count and nested
  memory estimates; original indexed correlation selectors remain DEFAULT;
  `indexCorrelationIds:false` / LOGS_INTERCEPTOR_INDEX_CORRELATION_IDS=false is
  an explicit lower-cardinality tradeoff, retaining IDs in JSON lines;
- reviewed shared nonbacktracking custom matching, finite certified internal
  defaults and explicit unsupported/budget rejection; see AUDIT-MATCHER.md.
  Snapshots/sanitization bound data but are not a universal DLP;
- correct gzip/Brotli bytes for advertised encodings, no accidental compression
  in `none` mode, finite request/connect/response limits and no echoed responses;
- bounded Worker backlog, clone/error/exit/timeout/destroy settlement, idle unref
  and no inherited preload inside internal Workers; only tagged SDK-owned
  workers suppress auto-init, while application Workers retain automatic logs;
- one active flush with quiet-tail timer rearming, bounded drain, cancellable retry sleeps and zero retries
  means one initial send; console cleanup restores only owned hooks; native
  Winston1000/end completes with the original synchronous callback contract and
  bounded logged notifications rather than the rejected deferred-callback change;
- private new DLQ files/directories, bounded file size, awaited directory setup,
  bounded recovery/count; plaintext passive DLQ is best effort, not replay or
  crash durability, and existing permissions/shared paths are not rewritten;
- compatible major-family resolution addresses captured production advisories,
  with no overrides, forced downgrade or renamed identity. The12 original Jest
  cases and all17 assertions are ported to node:test; Jest/ts-jest/types are
  removed from the active development graph to remove the unfixed deepmerge
  exposure. Original source tests/config remain historical references, not an
  active Jest installation. Current graph scans are not zero-CVE guarantees.
- clean generated build output before compilation and reject test artifacts in
  the archive; clean hosted and local candidate content must match.

Security budgets intentionally truncate oversized graphs, drop over-budget
buffer data and reject unsafe/over-budget configuration. Original stdout may
contain unredacted application data when preserveOriginalConsole is enabled.
Hostile Proxy traps/callbacks, arbitrary dynamic labels and application objects
are not sandboxed. Node 18/20 are EOL even when smoke compatible; production
should use maintained Node 22/24/26. Node22.0.0 is the revised explicit minimum;
EOL18/20 compatibility checks do not provide security support or qualify modern
development tools on those hosts.

Qualification uses the assertion-preserving node:test port, focused runtime regressions, real
Loki JSON/protobuf decode, all compression modes with and without Workers,
offline/429/trickle/large responses, saturation, and clean packed consumers.
Full Node-RED/browser deployments, a long soak, multi-process shared file DLQ,
Windows native bindings and production client outcomes remain UNKNOWN. Trace
suppression alongside independently installed OTel/Undici instrumentation needs
explicit integration qualification before a legacy release is accepted. The
coinstalled audited Elven SDK HTTP path was tested with actual OTLP plus Loki
export: the application span and GET were present, exporter POST spans and a
synthetic log password were absent. This does not qualify arbitrary third-party
Undici instrumentation. That integration record belongs to the prior2.1.7
candidate; it is not fresh3.0.0 coinstallation acceptance. The Node owner must
independently replay it against the new exact archive before promotion.

Future publication requires an owner-reviewed legacy release path with matching
public source/provenance. No new remote, merge, registry mutation or alias was
created. Documentation/migration must explicitly retain or translate the legacy
environment and transport contract; do not describe all Node libraries fixed.

Official docs and their source:
- https://docs.elven.works/elven-observability/integracao-e-instrumentacao/javascript/instrumentacao-node.js-com-elven-observability.html
- https://github.com/elvenworks-ps/docs.elven.works
