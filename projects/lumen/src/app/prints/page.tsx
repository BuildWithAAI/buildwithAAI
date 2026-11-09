import { getEngine } from "../../server/engine";

export default function PrintsPage() {
  const db = getEngine().db;
  const rows = db.prepare("SELECT id, title, status, adapter, material, estimated_cost_cents, reason FROM print_orders ORDER BY created_at DESC LIMIT 20").all() as {
    id: string;
    title: string;
    status: string;
    adapter: string;
    material: string;
    estimated_cost_cents: number | null;
    reason: string;
  }[];
  return (
    <div className="card">
      <p className="kicker">First workshop</p>
      <h1>Printed objects</h1>
      <p className="muted">Zoora can propose a design and a listing. Nothing is sent to a printer until the owner connects a print farm or a local queue. Cost figures here are estimates, not ledger facts, unless the ledger marks them confirmed.</p>
      {rows.length === 0 ? <p>No print jobs yet. The queue is off.</p> : null}
      <ul className="feed">
        {rows.map((row) => (
          <li key={row.id}>
            <strong>{row.title}</strong> · {row.material} · {row.status} · {row.adapter}
            <div className="muted">{row.reason}{row.estimated_cost_cents == null ? "" : ` · estimate $${(row.estimated_cost_cents / 100).toFixed(2)}, not a confirmed cost`}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}