# Reconstructed logs-interceptor 2.1.6 Source

This is the distinct npm identity `logs-interceptor`, not an alias for
`elven-logs-interceptor`. Nothing was published or merged.

The registry's 2.1.6 gitHead is `3c54e9d79c196a202216c61d7e92bfcf40044cde`,
whose package metadata says 2.1.0 / Node >=24. The next authoritative repository
commit `c7752a488380725ae98d2284d3c2d61591c063c9` says 2.1.6 / Node >=18,
but contains unshipped protobuf Worker and compression changes. Source maps do
not embed sourcesContent, and the repository has no release tags.

Recovery starts at c7752a4. BrotliCompressor, GzipCompressor,
LokiProtobufTransport and log-processor.worker source were recovered from
3c54e9d. Two published Pool timeout options, the published Worker task union
and the published util import order were reconciled against the registry
artifact. No unsupported new Worker protobuf task was retained.

Before any security patch, TypeScript rebuild comparison matched all 105
published JS/declaration files including preload after printer normalization
that removes comments only. It does not remove or reorder statements. Exact
hashes and individual matches are retained in the coordinating audit's
`evidence/node/followup/legacy-recovered-equivalence.json`. This proves the
recovered runtime/declaration correspondence in scope, not a historic signed
release or reproducible package metadata/source-map byte identity.

Primary independently inspectable inputs:
- https://registry.npmjs.org/logs-interceptor/2.1.6
- https://registry.npmjs.org/logs-interceptor/-/logs-interceptor-2.1.6.tgz
- https://github.com/leozw/logs-interceptor-js/commit/3c54e9d79c196a202216c61d7e92bfcf40044cde
- https://github.com/leozw/logs-interceptor-js/commit/c7752a488380725ae98d2284d3c2d61591c063c9

The old repository URL redirects to logs-interceptor-js. Any future legacy
publication needs its own reviewed branch and matching provenance decision;
the modern main-only publication workflow must not publish this branch.
