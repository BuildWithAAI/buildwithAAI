import { describe, expect, it } from "vitest";
import { allowPublicRequest } from "../src/auth/public";
import { openDatabase } from "../src/db/db";
import { jsonOrLimited, remember, SNAPSHOT_CACHE_MS } from "../src/http/publicRead";

describe("public read routes", () => {
  it("reuses a snapshot for a few seconds", () => {
    let loads = 0;
    const first = remember(null, 1_000, SNAPSHOT_CACHE_MS, () => {
      loads += 1;
      return { n: 1 };
    });
    const second = remember(first.slot, 2_000, SNAPSHOT_CACHE_MS, () => {
      loads += 1;
      return { n: 2 };
    });
    const third = remember(second.slot, 1_000 + SNAPSHOT_CACHE_MS, SNAPSHOT_CACHE_MS, () => {
      loads += 1;
      return { n: 3 };
    });
    expect(second.value).toEqual({ n: 1 });
    expect(third.value).toEqual({ n: 3 });
    expect(loads).toBe(2);
  });

  it("answers 429 once the read budget is spent", () => {
    const db = openDatabase();
    const now = 1_800_000_000_000;
    for (let i = 0; i < 120; i += 1) expect(allowPublicRequest(db, "203.0.113.20", now)).toBe(true);
    expect(allowPublicRequest(db, "203.0.113.20", now)).toBe(false);
    const limited = jsonOrLimited(false, { ok: true });
    expect(limited.status).toBe(429);
    return limited.json().then((body) => expect(body).toEqual({ error: "RATE_LIMIT" }));
  });
});
