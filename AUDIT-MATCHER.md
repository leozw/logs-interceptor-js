# Optional Legacy3 Shared Matcher

This is the distinct unpublished `logs-interceptor@3.0.0` optional major, not an
alias for modern `elven-logs-interceptor@2.0.0`. Promotion is parent-owned and next-only.
Existing `^2` users do not automatically upgrade. Node `>=22.0.0` is the revised
runtime contract; use currently patched maintained 22/24/26 builds in production.
Old 18.17/20 observations belong to the withdrawn earlier 3.x candidate, not this
engine graph. Exact minimum and current artifact tests are separate gates.

## Source Identity And Safety Boundary

The portable core and unchanged typed policy wrapper originate at sealed
modern commit5bab9d02db635b0c1337c73e6a913e77689112a6. The core is an exact byte copy, SHA256
6cf326f3d00a2727435cfe32044443895a369aa55e290ae98c8cad97a7d72f91.
The parent authorized integration, not modern/legacy independent acceptance or
promotion. Own final tuple and fresh independent review remain mandatory. Prior33/e921 core and local49cd/
97877f8b archive are rejected by the default-native lone-surrogate finding;
their green37 results do not waive it. Historical bytes remain immutable.
src/infrastructure/privacy/shared-core.json records origin and dependencies.
Safety-policy changes must be shared/reviewed, not independently forked here.
Build copies the .cjs and origin manifest into the actual package.
The sealed DetachedString.ts primitive is byte-identicalc7e55d7c; legacy uses
detachedString only, not its modern8192 identifier convenience. Inputs are owned
before native matching, generic matching and memoization; pattern sources and
replacement templates are owned too. Existing9369/a718/5f1480cd is historical
HOLD for own measured sliced-string retention, not an accepted release.

Custom predicates use re2js2.9.1 and @eslint-community/regexpp4.12.2 AST
normalization. Only exact14 internally owned certified default/builtin rules
use a captured native intrinsic; caller test/exec overrides are not invoked.
This is not heuristic safe-regex acceptance or a native fallback on failure.
Default-only masking does not load the parser/RE2 backend. All decisions still
consume one bounded execution shared through the actual record pipeline.

Full plan compilation/readiness validation precedes previous-runtime retirement
and transport/Worker construction. Rejecting a combined over-budget plan keeps
the previous actual logger usable. Direct utilities own a short-lived policy
when no execution is supplied. Calls close in finally; logger teardown closes
the compiled policy even when transport destruction fails.
Direct logger.destroy() retires only its own global instance; an old logger
cannot retire the replacement. Root facade and return signatures are retained.

## Public Contracts And Explicit Migration

Root CJS/ESM/preload/Winston/Morgan/Node-RED interfaces, old environment names,
Loki JSON/protobuf, codecs, indexed trace/span/request selectors DEFAULT,
application Worker auto-init, synchronous Winston completion, quiet-tail
one-sender behavior and existing bounded eviction counter are retained.
Selectors still inspect the already truncated/redacted message in this legacy
line. No modern pipeline order, OTLP default or renamed package is substituted.

Keys use explicit sensitivity; values also use builtin masks. Known-sensitive
correlation values are masked in body and labels. Valid hex trace/span IDs have
generic PAN exemption only; explicit rules and matcher failure always prevail.
sanitize:false remains an explicit privacy opt-out, not a selector-safety bypass.
Raw preserved stdout and passive plaintext DLQ are not generic DLP guarantees.

RegExp[] shapes remain, but initialized policies are declarative snapshots.
Re-init to change rules; mutating arrays/RegExp later no longer updates the
initialized matcher. Caller lastIndex is not changed. Deterministic boolean
matching starts at zero, not a public native exec/indices/callback API.

Unsupported lookaround/backreferences, Unicode properties/v sets, unsupported
case-fold/flag combinations and inputs not representable under the JS adapter
reject startup or fail closed at runtime. No fallback to arbitrary JS matching.
JS whitespace/NBSP/BOM, supported dot/case/flag behavior must pass actual tests.
Lone-surrogate/non-u surrogate-sensitive and unsupported multiline inputs can
be masked/dropped. This is not full JavaScript-RegExp semantic equivalence.

New limits intentionally differ from old2.x/prior candidates:

| Budget | Limit |
| --- | --- |
| Caller rules | 32 per role, plus6 fixed builtin value rules |
| Source/AST/depth | 256 UTF16 source units,256 AST nodes,depth16,captures16 |
| Expansion | 1024/rule,4096 aggregate before backend compile |
| Normalized source | 8192/rule,32768 aggregate |
| Actual instructions | 4096/rule,32768 aggregate |
| Boolean DFA accounting | 64KiB/rule,4.375MiB total |
| Input memo | 64Ki distinct UTF16 units/record,2048 values |
| Calls/work | 65536 calls,33554432 estimated weighted work units/record |
| Private string substitution | 128 matches,1024 replacement units,65536 output |

The prior512 source allowance is not retained. Input/storage limits do not imply
every maximal stored message fits aggregate matching budgets. Failed privacy
decisions mask; failed selectors drop. Fixed enum codes appear in privacyCodes
health state without source/input/backend messages. Unsafe callbacks/Proxy
traps are not sandboxed. Accounting excludes allocator/object/compiler overhead;
no hard whole-process RSS, universal CPU, zero overhead or whole-app3% claim.

## Coverage And Gates

The retained 30 native cases are 12 earlier runtime, 12 original Jest ports and 6
LR/drop-count regressions. All 17 original historical assertions/titles remain
mapped by tests/jest-port-inventory.cjs; original source/Jest config unchanged.
No claim is made that these equal any modern Jest suite.
An additional native case guards exact numeric-only comparisons and the original
rejected-toThrow Error/callback semantics, including coercion negatives and
cross-realm errors. The AST ledger also maps operators, not only counts. Original
clearAllMocks had no declared mocks/spies in this twelve-case suite; that does
not establish parity for the modern mock-heavy suite. Active suite total is 54.

Seven own detachment/configuration cases add UTF16 code-unit/prefix controls,
snapshot keys/arrays/getters/cycles, provider identity and values above512,
exact configuration units/nodes/depth boundaries, atomic rejection before and
after defaults, existing configurable message limits/default dimensions/IDs,
and no resurrection of unfiltered correlation fields after bounded omission.
Actual GC/heap/wire matrices remain separately hash-bound evidence, not assertions
that string equality alone proves physical detachment. Caller/provider/active
ALS references and trusted low-level raw-buffer use remain explicit exclusions.

Eight own retry cases additionally cover separate-field/date/invalid/huge
parsing, monotonic floor expiry/deadline refusal, real public JSON/protobuf
429/503 retry and cross-send floors, identical payload retry after delta/date,
direct/decorated concurrent-call isolation, invalid-header recovery and huge
manual reinit, actual network deadline/cancellation and codec reuse, and scoped
queued/running Worker cancellation without oversubscription. A controlled owned
Worker stalls the actual JSON formatting path; it must abort without HTTP
fallback and leave unrelated work usable. These are synthetic local tests, not
modern proof or AWS acceptance. Shared matcher core/wrapper/helper bytes remain
6cf326f3/8d8f4424/c7e55d7c, unchanged by transport remediation.

Eight matcher cases add exact core identity, actual custom backend calls,
owned child watchdogs for original64a and engine-reaching near-miss inputs on
six info paths/direct utils/static init, default lazy masks, JSON/protobuf
correlation privacy/IDs, previous-runtime preservation/ownership, enum health, ordinary
scalar budgets, source/count rejection and rule-state/order migration. The
500-field public fixture retains the OLD snapshot caps; full500-scalar matching
is checked separately. Test harness deadlines are containment, not the fix.
The added UTF16 case exercises 48 actual public JSON/protobuf combinations:
default/generic policy, high/low lone surrogate and six sites. Context-key masking
retains the old key shape but hides its associated value. Selector safety is
checked with explicit sanitize:false. Twelve valid astral/BOM/NBSP wire controls
preserve ordinary values and existing Bearer masks.

New source/lock/archive identity, fresh exact-minimum and maintained Linux
runtime/clean-consumer checks, actual transports, strict declarations, advisory
graph/SBOM and a different owner's SDK09/source/archive review remain required.
Windows/browser/edge, universal overhead, Linux ARM/AWS/customer acceptance and
long soak are not claimed merely from local green tests. Consult exact current
receipts. Old2.1.7/f7c6 and withdrawn0565/93425d7 artifacts remain immutable.

Jest/deepmerge were removed only after the original assertion-preserving port.
The upstream deepmerge CVE remains unfixed; old installed2.x is not remediated
by this candidate. Advisories are dated matches, never zero-CVE proof. The
maintainer RE2JS advisory affected>=2.2.0<2.8.7, fixed2.8.7; no affected release
or older unmaintained engine is selected to fake an18.x floor.

Primary references:
[RE2JS manifest](https://raw.githubusercontent.com/le0pard/re2js/2.9.1/package.json),
[maintainer advisory](https://github.com/le0pard/re2js/security/advisories/GHSA-gg6h-894w-4m9c),
[Node ReDoS guidance](https://nodejs.org/learn/asynchronous-work/dont-block-the-event-loop),
[deepmerge CNA](https://www.vulncheck.com/advisories/deepmerge-through-4.3.1-prototype-poisoning-via-mergeobject),
[documentation source](https://github.com/elvenworks-ps/docs.elven.works).
No publication/merge/deployment/credential or AWS action is authorized here.
