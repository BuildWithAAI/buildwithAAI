import { printCheckoutOpen, printsForSale, shipCountries, shippingCents } from "../../fulfillment/pod";
import { getEngine } from "../../server/engine";
import { shopCheckoutOpen } from "../../shop/store";
import { printBuy } from "../actions";

export const dynamic = "force-dynamic";

export default async function MerchPage({ searchParams }: { searchParams: Promise<{ sales?: string; checkout?: string }> }) {
  const params = await searchParams;
  const engine = getEngine();
  const items = printsForSale(engine.db, Date.now());
  const open = printCheckoutOpen(engine.env, shopCheckoutOpen(engine.db, engine.env));
  const shipping = shippingCents(engine.env);
  return (
    <div>
      <p className="kicker">Zoora&apos;s prints</p>
      <h1>Her drawings, printed</h1>
      <p className="muted">
        Each one is made to order by a print company after you pay, and posted to you. Ships to: {shipCountries(engine.env).join(", ")}.
        {shipping > 0 ? ` Shipping is $${(shipping / 100).toFixed(2)}.` : " Shipping is included."} The drawings are AI-generated.
      </p>
      {params.sales === "soon" ? <p className="warn">Not open yet. No payment was taken.</p> : null}
      {params.checkout === "success" ? <p>Paid. Thank you. It will be printed and posted. If it cannot be made, your money is sent back.</p> : null}
      {params.checkout === "cancel" ? <p className="muted">Checkout was closed. No payment was taken.</p> : null}
      {items.length === 0 ? <p>Nothing is out yet.</p> : null}
      {items.map((item) => (
        <article className="card" key={item.id} style={{ marginTop: "1rem" }}>
          <p className="kicker">print · AI-generated</p>
          <h2>{item.title}</h2>
          <p><a href={item.artUrl} target="_blank" rel="noreferrer noopener">See the drawing</a></p>
          <p>${(item.retailCents / 100).toFixed(2)}</p>
          {open ? (
            <form action={printBuy}>
              <input type="hidden" name="id" value={item.id} />
              <button type="submit">Pay by card</button>
            </form>
          ) : (
            <p className="muted">Checkout is closed. No card payment is taken.</p>
          )}
        </article>
      ))}
    </div>
  );
}
