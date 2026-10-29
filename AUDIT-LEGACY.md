# Legacy 2.1.7 Review Candidate

Unpublished compatible backport for the distinct `logs-interceptor` identity.
This branch must not replace modern main or be published by its main-only
modern-package workflow. See RECOVERY.md for the 105/105 rebuilt runtime and
declaration correspondence before security edits and the stale registry gitHead.

Preserved: public init/getLogger/logger/destroy APIs, old LOGS_INTERCEPTOR_*
environment, Loki JSON and protobuf/Snappy, compression modes, and Node-RED/
Winston/Morgan entry points. No LOGS_* rename, OTLP defaults or package alias.

Backport changes:
- bounded detached graphs before application context spread and serialization;
  no ordinary getter/toJSON execution; finite buffer memory/count and nested
  memory estimates; correlation IDs outside automatic indexed stream labels;
- deterministic regex state, finite email matching and unsafe custom-regex
  rejection; snapshots/sanitization bound data but are not a universal DLP;
- correct gzip/Brotli bytes for advertised encodings, no accidental compression
  in `none` mode, finite request/connect/response limits and no echoed responses;
- bounded Worker backlog, clone/error/exit/timeout/destroy settlement, idle unref
  and no inherited preload inside internal Workers; both auto-init paths gate
  non-main threads;
- one active flush, bounded drain, cancellable retry sleeps and zero retries
  means one initial send; console cleanup restores only owned hooks;
- private new DLQ files/directories, bounded file size, awaited directory setup,
  bounded recovery/count; plaintext passive DLQ is best effort, not replay or
  crash durability, and existing permissions/shared paths are not rewritten;
- compatible dependency resolution fixes known production advisories, with no
  overrides, forced downgrade or renamed identity. Jest deepmerge remains a
  development advisory without a compatible upstream remediation.
- clean generated build output before compilation and reject test artifacts in
  the archive; clean hosted and local candidate content must match.

Security budgets intentionally truncate oversized graphs, drop over-budget
buffer data and reject unsafe/over-budget configuration. Original stdout may
contain unredacted application data when preserveOriginalConsole is enabled.
Hostile Proxy traps/callbacks, arbitrary dynamic labels and application objects
are not sandboxed. Node 18/20 are EOL even when smoke compatible; production
should use maintained Node 22/24/26. Existing >=18 metadata is not a guarantee
for every early Node 18 minor or modern development tools.

Qualification uses the original Jest suite, focused runtime regressions, real
Loki JSON/protobuf decode, all compression modes with and without Workers,
offline/429/trickle/large responses, saturation, and clean packed consumers.
Full Node-RED/browser deployments, a long soak, multi-process shared file DLQ,
Windows native bindings and production client outcomes remain UNKNOWN. Trace
suppression alongside independently installed OTel/Undici instrumentation needs
explicit integration qualification before a legacy release is accepted. The
coinstalled audited Elven SDK HTTP path was tested with actual OTLP plus Loki
export: the application span and GET were present, exporter POST spans and a
synthetic log password were absent. This does not qualify arbitrary third-party
Undici instrumentation.

Future publication requires an owner-reviewed legacy release path with matching
public source/provenance. No new remote, merge, registry mutation or alias was
created. Documentation/migration must explicitly retain or translate the legacy
environment and transport contract; do not describe all Node libraries fixed.

Official docs and their source:
- https://docs.elven.works/elven-observability/integracao-e-instrumentacao/javascript/instrumentacao-node.js-com-elven-observability.html
- https://github.com/elvenworks-ps/docs.elven.works
