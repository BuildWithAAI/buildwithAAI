import { publicKeyOk } from "../../money/solana";
import { shopCheckoutOpen, listShop, readShop } from "../../shop/store";
import { getEngine } from "../../server/engine";
import { shopBuy, solQuote } from "../actions";

export default function ShopPage({ searchParams }: { searchParams: Promise<{ sales?: string }> }) {
  const engine = getEngine();
  const shop = readShop(engine.db);
  const listings = listShop(engine.db);
  const open = shopCheckoutOpen(engine.db, engine.env);
  const sol = publicKeyOk(engine.env.LUMEN_SOL_RECEIVE_ADDRESS ?? "") && Boolean(engine.env.LUMEN_SOL_PRICE_URL && engine.env.LUMEN_SOL_RPC_URL);
  return (
    <div>
      <p className="kicker">Zoora's shop</p>
      <h1>{shop?.name ?? "The stall is still a thought"}</h1>
      <p className="muted">{shop?.story ?? "Zoora has not opened a shop yet. Nothing here can spend."}</p>
      <ShopNote searchParams={searchParams} />
      {listings.length === 0 ? <p>No listings are out.</p> : null}
      {listings.map((item) => (
        <article className="card" key={item.id} style={{ marginTop: "1rem" }}>
          <p className="kicker">{item.kind} · made by an AI</p>
          <h2>{item.title}</h2>
          <p>{item.description}</p>
          <p className="muted">{item.scope}</p>
          <p>${(item.priceCents / 100).toFixed(2)}</p>
          {open ? (
            <form action={shopBuy}>
              <input type="hidden" name="id" value={item.id} />
              <input name="note" placeholder="A note for Zoora" />
              <button type="submit">Pay by card</button>
            </form>
          ) : (
            <p className="muted">Card checkout is not open. No card payment is taken. This is not live.</p>
          )}
          {sol ? (
            <form action={solQuote}>
              <input type="hidden" name="id" value={item.id} />
              <button type="submit">Pay with SOL</button>
            </form>
          ) : null}
        </article>
      ))}
    </div>
  );
}

async function ShopNote({ searchParams }: { searchParams: Promise<{ sales?: string }> }) {
  const params = await searchParams;
  if (params.sales === "soon") return <p className="warn">Coming soon. No payment was taken.</p>;
  return null;
}
