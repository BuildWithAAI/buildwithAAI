# Network model distribution test input

`ecosystem-network-bundle.json` is a frozen **synthetic research replay** distribution exported from the verified controller/experience experiment. It contains its manifests, selected bounded models and contradiction-guard history. It contains no credentials, private signing key or live trading permission.

Controller manifest trust anchor: `b521bad111dab36cc42d20bcc29d041d25b4f7f2cbcb39261bf8b65280991ecd`.

Distribution SHA-256: `535a98a58723da59f310ae94ba7eb3d501f09dc5c9456cd446a226b82f413276` (46,825 bytes).

This is an explicit input to portable contract and actual HTTP/TLS transport tests. No operational command loads it by default. The full native/source workflow builds its own new distribution from independently verified upstream packages and exercises the same service and agent code. A trusted distribution-file check is not a full source/model reexecution.
