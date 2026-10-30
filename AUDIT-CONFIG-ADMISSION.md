# Optional Legacy3 Configuration Admission Follow-up

This continuation starts from734d69c/c518, not modern logger main. It keeps the
unpublished `logs-interceptor@3.0.0`, Node>=22.0.0 and `next` identity. The new
source commit and archive SHA must be reviewed separately; old c518, f7c6 and
unpublished2.1.7 archives, source exports and UNKNOWN receipts stay immutable.
Nothing here authorizes registry publication, credentials, merge or deployment.

## L3-IR-01: Admit Caller DTO Before Merging

Root `init()` now snapshots the caller before environment merge or nested reads.
The existing configuration units/nodes/keys/depth budgets and descriptor-only
accessor rejection therefore apply before spreads can materialize a getter.
Provider functions and RegExp references retain their supported identity, the
caller graph is not mutated, and fixed rejection precedes prior logger retirement.
RegExp enumerable descriptors are traversed within the same budget without
replacing the pattern reference; null/array/function/RegExp roots are not DTOs.
Proxy traps, arbitrary provider closure lifetimes and hostile global prototypes
are not sandboxed. The exported generic merge helper is not a config sandbox.

## L3-IR-02: Consistent Sanitize Environment Policy

One parser serves root and preload. Case-insensitive `true`/`false` are recognized;
only `false` opts out. All other values leave sanitation on, including missing,
empty, numeric-looking and whitespace-padded strings. Explicit programmatic
`filter.sanitize:false` remains supported. This fixes a conditional typo risk in
the public2.1.6 root parser, not a claim that default2.x disables sanitation.
Preload now also recognizes uppercase `FALSE` consistently; this is an explicit
optional-major normalization, not an automatic change for existing^2 users.

## L3-IR-03: Memory DLQ Capacity Admission

The public MemoryDeadLetterQueue constructor and root memory-DLQ config require
a positive safe integer, with default1000 unchanged. Explicit NaN, Infinity,
zero, negatives, fractions, unsafe integers and nonnumbers reject with fixed
`ELVEN_LEGACY_DLQ_CAPACITY`; no caller value is included in that code.
No new arbitrary low ceiling or modern logger payload limit is imposed.
The caller must choose a practical count; this is not a byte/RSS or total-process
memory bound. Trusted low-level LogEntry references remain by reference. File
DLQ storage units and shared-path concurrency are separate, unchanged contracts.

## Regression And Promotion Gates

Seven new native tests extend the prior54 to61; no original assertion is removed.
They cover actual root/nested getters, prior logger wire export after rejection,
provider identity/caller state, root/preload Bearer wire with valid/invalid boolean
tokens, direct/root malformed capacity rejection and1002 tiny entries trimmed to
default1000/explicit3. There is no stress, infinite-capacity allocation or new
process supervisor in these controls. Baseline c518 fails five of the seven
controls on actual22.0.0; fixed-source, packed and four-runtime receipts are
separate qualification evidence, not inherited proof or independent acceptance.

Required promotion checks remain lint/build/types, original12-test inventory,
all64 source and installed tests on min22/current22/24/26, original wire/Worker/
Winston/API contracts, own15 GC controls per profile, prod+dev advisories, exact
source/archive identity and fresh independent review. Keep platform/native/SDK
coinstallation and public-relative overhead limits honest; no blanket RSS or
zero-CVE claim is made. New archives are under `release/3.0.0/<new-source>/`.

The optional old low-level preparation race remains UNKNOWN/nonblocking; v2
stopped in preflight without a child. Its source/receipt is not rewritten or rerun.
Ordinary facade simultaneous-flush reachability remains source-refuted by
pendingFlush serialization. Neither that result nor these three conditional
configuration fixes is a universal facade/customer P1 claim.

The new source proactively adds a final same-turn gate check/request invocation
to both public codecs using their existing owned RetryGate, without changing
facade serialization, global concurrency or independent-operation cancellation.
Three additional controls bring the suite to64. They run actual JSON/protobuf
requests with deterministic scheduling through an instrumented public wait
method, and test final abort/deadline/degraded checks. These are disclosed
post-fix synthetic scheduling controls, not an unmocked old-race reproduction.
Finite expiry and ordinary independent/single sends remain functional.
