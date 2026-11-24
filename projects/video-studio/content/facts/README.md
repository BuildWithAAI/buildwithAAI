# content/facts

The reusable fact bank. Read `docs/FACT_BANK.md` for the schema, the rules and the commands.

- `facts.jsonl`: the facts, one JSON object per line, sorted by id. Edit it through `node scripts/facts/cli.ts` (`add`, `verify`, `confirm`, `to-storyboard`), not by hand. Run `node scripts/facts/cli.ts validate` after any manual change.
- `hosts.json`: the hosts `verify` may fetch, which are the news hosts the owner allowed in this environment.
- `SEED.md`: where the first 39 facts came from (the research fact-checks of 2026-11-24) and what was left out.

This folder holds no `storyboard.json`, so the claim gate's `--all` walk skips it.
