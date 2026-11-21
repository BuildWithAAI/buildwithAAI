import { Ledger, moneyView } from "../../money/ledger";
import { moneyLive } from "../../money/rules";
import { tradingLive } from "../../trading/book";
import { getEngine } from "../../server/engine";

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export default function BooksPage() {
  const view = moneyView(new Ledger(getEngine().db).list());
  return (
    <div className="card">
      <p className="kicker">{tradingLive() ? "LIVE" : "PAPER"}</p>
      <h1>Confirmed balance</h1>
      <p className="money">{money(view.confirmedCents)}</p>
      <p className="muted">Only rows a provider confirmed. Unconfirmed and mock rows are not included. {moneyLive() ? "Live money is on." : "Checkout is closed. This is not live."}</p>
      <table>
        <tbody>
          <tr><th>Sales, gross</th><td>{money(view.salesCents)}</td></tr>
          <tr><th>Net sales</th><td>{money(view.netSalesCents)}</td></tr>
          <tr><th>Purchases</th><td>{money(view.purchaseCents)}</td></tr>
          <tr><th>Card refunds received</th><td>{money(view.cardRefundCents)}</td></tr>
          <tr><th>Buyer refunds paid</th><td>{money(view.buyerRefundCents)}</td></tr>
          <tr><th>Payouts</th><td>{money(view.payoutCents)}</td></tr>
          <tr><th>Disputes</th><td>{money(view.disputeCents)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
