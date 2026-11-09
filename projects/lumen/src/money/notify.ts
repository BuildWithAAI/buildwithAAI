import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type OwnerAlert = {
  kind: "reconciliation" | "dispute";
  title: string;
  detail: string;
};

/** Desk today. A Telegram sender can wrap this later without changing callers. */
export interface OwnerNotifier {
  notify(alert: OwnerAlert): void;
}

export function deskNotifier(db: DatabaseSync): OwnerNotifier {
  return {
    notify(alert) {
      db.prepare("INSERT INTO owner_alerts(id, kind, title, detail, created_at) VALUES(?, ?, ?, ?, ?)").run(
        randomBytes(8).toString("hex"),
        alert.kind,
        alert.title,
        alert.detail.slice(0, 500),
        Date.now(),
      );
    },
  };
}

export function listAlerts(db: DatabaseSync): { id: string; kind: string; title: string; detail: string; created_at: number }[] {
  return db.prepare("SELECT id, kind, title, detail, created_at FROM owner_alerts ORDER BY created_at DESC LIMIT 20").all() as {
    id: string;
    kind: string;
    title: string;
    detail: string;
    created_at: number;
  }[];
}
