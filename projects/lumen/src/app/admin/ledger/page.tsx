import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { OWNER_COOKIE } from "../../../auth/owner";
import { loginReachable, ownerRouteOpen } from "../../../auth/publicMode";
import { executeAction, refundAction } from "../../actions";
import { getEngine } from "../../../server/engine";

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export default async function LedgerPage() {
  const jar = await cookies();
  const token = jar.get(OWNER_COOKIE)?.value ?? null;
  const authed = getEngine().authed(`${OWNER_COOKIE}=${encodeURIComponent(token ?? "")}`);
  if (!authed || !ownerRouteOpen("/admin/ledger", authed)) {
    if (!loginReachable((await headers()).get("fly-client-ip"))) notFound();
    redirect("/admin/login");
  }
  const snap = getEngine().snapshot();
  const view = snap.money.view;
  const rows = snap.money.ledger as { id: string; kind: string; amountCents: number; status: string; label: string; providerTransactionId: string | null; note: string; ref: string | null }[];
  const disputes = snap.money.disputes as { id: string; status: string; amount_cents: number; reason: string }[];
  return (
    <div>
      {snap.money.reconciliationAlert ? <div className="banner">Reconciliation alert is on. Auto-approval is paused. These figures still come only from the ledger.</div> : null}
      <section className="card">
        <p className="kicker">Balance</p>
        <h1>Confirmed balance</h1>
        <p className="money">{money(view.confirmedCents)}</p>
        <p className="muted">Only provider-confirmed ledger rows. Nothing else is treated as money.</p>
        <h2>Unconfirmed — not real money</h2>
        <p className="money warn">{money(view.unconfirmedCents)}</p>
        <p className="muted">Pending, mock, and not-yet-confirmed rows live here. They are not a balance.</p>
      </section>
      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>P&amp;L from confirmed rows</h2>
        <table>
          <tbody>
            <tr><th>Sales</th><td>{money(view.salesCents)}</td></tr>
            <tr><th>Purchases</th><td>{money(view.purchaseCents)}</td></tr>
            <tr><th>Fees</th><td>{money(view.feeCents)}</td></tr>
            <tr><th>COGS estimates (not real)</th><td className="warn">{money(view.cogsEstimateCents)}</td></tr>
            <tr><th>Refunds</th><td>{money(view.refundCents)}</td></tr>
            <tr><th>Payouts</th><td>{money(view.payoutCents)}</td></tr>
            <tr><th>Disputes (signed)</th><td>{money(view.disputeCents)}</td></tr>
          </tbody>
        </table>
      </section>
      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Open disputes</h2>
        {disputes.length === 0 ? <p className="muted">No open disputes.</p> : null}
        <ul className="feed">
          {disputes.map((dispute) => (
            <li key={dispute.id}>{dispute.id} · {dispute.status} · {money(dispute.amount_cents)} · {dispute.reason}</li>
          ))}
        </ul>
        <h2>Owner refund</h2>
        <p className="muted">Refunds stay unconfirmed until Stripe sends charge.refunded.</p>
        <form action={refundAction}>
          <input name="charge" placeholder="Stripe charge or payment intent id" />
          <input name="key" placeholder="Idempotency key" />
          <button type="submit">Request refund</button>
        </form>
      </section>
      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Ledger</h2>
        <table>
          <thead><tr><th>Kind</th><th>Amount</th><th>Reality</th><th>Provider id</th><th>Note</th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={5}>No ledger rows yet. Confirmed balance stays at $0.00.</td></tr> : null}
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.kind}</td>
                <td>{money(row.amountCents)}</td>
                <td className={row.status === "confirmed" ? "good" : "warn"}>{row.label}</td>
                <td>{row.providerTransactionId ?? "—"}</td>
                <td>{row.note}{row.status === "pending" && row.ref ? <form action={executeAction}><input type="hidden" name="id" value={row.ref} /><button type="submit">Owner execute</button></form> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
