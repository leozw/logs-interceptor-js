# Standard-Library Test Port

Baseline: `0d04a335d23ed7a18057a206503d4e8aa3ca53c1`, actual Jest/expect
30.5.2. The original Jest configuration is retained unchanged and is not active.

All seven original source files, 67 expanded case titles, 144 assertion sites and
351 executed assertions are inventoried in `port-inventory.json`, including each
old matcher expression/operator, new expression and containing case title.
Counts alone are not semantic proof. The conversion was also reviewed by body,
operator, callback ordering, exception behavior and mock restoration.

## Semantics

- `toBe`/undefined/defined/length use strict standard assertions.
- Numeric comparisons require primitive number or bigint on both sides. No
  coercion of strings, booleans, null, boxed numbers or valueOf callbacks.
- Used `rejects.toThrow(any/string)` accepts Error/Exception/DOMException across
  realms and the upstream rare rejected-function-that-throws branch; plain
  rejection values and nonthrowing rejected functions fail. Sync string checks
  preserve thrown-value message conversion. No generic matcher framework added.
- 196 differential controls matched installed expect before dependency removal;
  seven retained standard-library tests exercise negative/cross-realm/mocks.
- String containment and the used plain-string array membership retain their
  behavior. Deep strict equality/subset comparisons are stricter about prototypes
  and undefined properties than Jest toEqual; all compared source fixtures are
  ordinary JSON/plain arrays/objects. This is not general Jest API equivalence.
- All 28 mock functions and two method spies preserve call arguments, returned
  promises, throws, receivers and restoration. No fake timers/module mocks were
  used. The integration clearAllMocks fixture creates no mocks; resetting its
  empty per-file tracker is equivalent, not a general clearAllMocks replacement.
- Data-provider rows and complete expanded titles match the baseline. Cases are
  serialized; global environment/logger/console/provider state is not parallel.

## Execution

`npm test` compiles TypeScript to a fresh per-run `.test-dist/run-*` directory,
copies the unchanged Worker fixture/core and runs standard node:test. Only that
owned temporary directory is removed afterward. `npm run test:port` additionally
checks original titles/assertion counts and runs the seven separate controls.
Its optional inventory preload delegates each assertion to the real builtin.
Output parsing handles split/coalesced stdout events, not assumed write chunks.
`npm run test:watch` uses TypeScript's watcher, serial reruns and owned-child
termination; actual 22.0.0 qualification completed two 67-case cycles and cleanup.

Actual 22.0.0 and current 22/24/26 passed all 67/351, seven controls and 16 portable
matcher tests after clean anonymous install. Production dependencies, runtime
files, matcher core, budgets, default dimensions, Node floor and caller behavior
are unchanged by this port. Generated tests/helpers are not in the package's
explicit files list. A green test port does not accept the separate known
borrowed-string retention P1 in the base runtime or qualify an SDK benchmark.

## Advisory Scope

Jest/ts-jest/@types-jest were removed only after the equivalence checks. Removing
their development tree removes deepmerge from this candidate, without an
override, downgrade or skipped audit. Fresh production and complete development
npm audits reported zero known findings at their recorded timestamp; this is not
a zero-vulnerability claim for unknown advisories or older graphs.

[CVE-2026-93753 CNA record](https://raw.githubusercontent.com/CVEProject/cvelistV5/main/cves/2026/93xxx/CVE-2026-93753.json)
rates High 8.7 while the
[GitHub advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
currently rates Low 2.7 and lists no patched version. That distinction and the
upstream unfixed condition are retained, not downgraded by removal from our graph.
