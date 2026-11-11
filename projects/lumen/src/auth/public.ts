import type { DatabaseSync } from "node:sqlite";
import { allowRate } from "../db/db";

export const PUBLIC_RATE_LIMIT = 120;
export const PUBLIC_RATE_WINDOW_MS = 60_000;

export function allowPublicRequest(db: DatabaseSync, address: string, now = Date.now()): boolean {
  return allowRate(db, `public:${address || "unknown"}`, PUBLIC_RATE_LIMIT, PUBLIC_RATE_WINDOW_MS, now);
}
