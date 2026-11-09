import type { DatabaseSync } from "node:sqlite";
import { Ledger } from "../money/ledger";
import type { FulfillmentAdapter, PrintJobRequest } from "./adapters";
import type { DesignProposal } from "./design";

export type PrintOrder = {
  id: string;
  designId: string;
  title: string;
  status: "blocked" | "queued" | "disabled";
  adapter: string;
  material: string;
  quantity: number;
  estimatedCostCents: number | null;
  reason: string;
};

export function openPrintOrder(db: DatabaseSync, design: DesignProposal, adapter: FulfillmentAdapter, atMs: number): PrintOrder {
  const job: PrintJobRequest = { id: `job-${design.id}`, designId: design.id, title: design.title, material: design.material, quantity: 1 };
  const result = adapter.configured && adapter.name === "mock" ? adapter.submit(job) : adapter.submit(job);
  const status = result.ok ? "queued" : result.reason === "NOT_CONFIGURED" || result.status === "disabled" ? "disabled" : "blocked";
  db.prepare(
    "INSERT INTO print_orders(id, design_id, title, status, adapter, material, quantity, estimated_cost_cents, created_at, reason) VALUES(?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
  ).run(job.id, design.id, design.title, status, adapter.name, design.material, design.estimatedCostCents, atMs, result.reason);
  if (design.estimatedCostCents != null && design.estimatedCostCents > 0) {
    new Ledger(db).append({
      id: `cogs-${job.id}`,
      atMs,
      kind: "fee",
      amountCents: design.estimatedCostCents,
      status: "unconfirmed",
      provider: null,
      providerTransactionId: null,
      idempotencyKey: `cogs:${job.id}`,
      ref: job.id,
      note: "COGS estimate (filament or print-farm fee). Unconfirmed, not real money.",
    });
  }
  return { id: job.id, designId: design.id, title: design.title, status, adapter: adapter.name, material: design.material, quantity: 1, estimatedCostCents: design.estimatedCostCents, reason: result.reason };
}
