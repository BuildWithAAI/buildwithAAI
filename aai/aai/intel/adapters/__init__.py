"""One adapter per public, keyless source. Each exposes fetch(fetcher, cfg, prev) -> payload (raises FetchError)
and a pure parse(...) used by the recorded-fixture tests."""
