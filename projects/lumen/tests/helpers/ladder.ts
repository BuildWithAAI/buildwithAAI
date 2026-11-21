import type { DatabaseSync } from "node:sqlite";
import { ensureEconomy } from "../../src/economy/economy";
import { setLadderMode } from "../../src/economy/ladder";

/** For tests of the live trading path itself: the owner has approved the top of the ladder. */
export function grantLiveTrading(db: DatabaseSync): DatabaseSync {
  ensureEconomy(db);
  setLadderMode(db, "earned");
  db.prepare("INSERT OR REPLACE INTO econ_milestones(threshold_cents, reached_at, measure_cents, status, decided_at, unlock) VALUES(100000000, 1, 100000000, 'approved', 1, 'test')").run();
  return db;
}
