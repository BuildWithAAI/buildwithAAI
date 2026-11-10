import { Ledger, moneyView } from "../../money/ledger";
import { getEngine } from "../../server/engine";

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export default function BooksPage() {
  const view = moneyView(new Ledger(getEngine().db).list());
  return (
    <div className="card">
      <p className="kicker">Public books</p>
      <h1>Confirmed balance</h1>
      <p className="money">{money(view.confirmedCents)}</p>
      <p className="muted">Only rows a provider confirmed. Unconfirmed and mock rows are not included.</p>
      <table>
        <tbody>
          <tr><th>Sales</th><td>{money(view.salesCents)}</td></tr>
          <tr><th>Purchases</th><td>{money(view.purchaseCents)}</td></tr>
          <tr><th>Refunds</th><td>{money(view.refundCents)}</td></tr>
          <tr><th>Payouts</th><td>{money(view.payoutCents)}</td></tr>
          <tr><th>Disputes</th><td>{money(view.disputeCents)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
