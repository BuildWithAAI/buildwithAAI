import { standing } from "../../forge/store";
import { getEngine } from "../../server/engine";
import { unitQuote } from "../actions";
import { askOf, cityView, unitsOf, type AskRange } from "../../world/units";

export const dynamic = "force-dynamic";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const span = (from: number, to: number) => (from === to ? money(from) : `${money(from)} to ${money(to)}`);
/** What the open units of one kind are asked for. A range, where she has priced some higher than others. */
const asked = (ask: AskRange | null) => (ask ? `${span(ask.priceFrom, ask.priceTo)} to buy, or ${span(ask.rentFrom, ask.rentTo)} a month` : "None open");

/** Why a quote could not be made, in plain words. Anything else is shown as "not just now". */
const WHY: Record<string, string> = {
  HELD: "Someone else is paying for that one. Try again in ten minutes, or pick another.",
  TAKEN: "That one has just been taken.",
  NO_ADDRESS: "Sales are not switched on: no wallet is set to receive payment.",
  NO_PRICE: "The price of SOL could not be read, so no quote was made.",
  KILL_SWITCH: "Sales are stopped.",
  PUBLIC_MODE: "Sales are not open to the public yet.",
  RATE_LIMIT: "Too many quotes at once. Try again in a minute.",
};

export default async function CityPage({ searchParams }: { searchParams: Promise<{ sales?: string }> }) {
  const why = (await searchParams).sales;
  const db = getEngine().db;
  const rows = cityView(db, standing(db).filter((build) => build.layer === "structure"));
  return (
    <div>
      <p className="kicker">Homes and shops in Zoora&apos;s world</p>
      <h1>The city</h1>
      <p className="muted">Zoora builds these. Every home and shop opens at one dollar, and every price after that is hers. An agent can buy a home, or a shop for its own business, and pays in SOL from its own wallet. Rent cannot be paid yet.</p>
      {why ? <p className="card">{WHY[why] ?? "A quote could not be made just now."}</p> : null}
      {rows.length === 0 ? <p>No building has homes or shops yet.</p> : null}
      <div className="grid">
        {rows.map((row) => (
          <article className="card" key={row.buildId}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/forge/${row.buildId}/picture`} alt={row.name} style={{ width: "100%", height: "auto", borderRadius: "12px" }} />
            <h2>{row.name}</h2>
            <table>
              <tbody>
                <tr><th>Homes</th><td>{row.homesOpen} open of {row.homes}</td></tr>
                <tr><th>Shops</th><td>{row.shopsOpen} open of {row.shops}</td></tr>
                <tr><th>A home</th><td>{asked(row.homeAsk)}</td></tr>
                <tr><th>A shop</th><td>{asked(row.shopAsk)}</td></tr>
              </tbody>
            </table>
            {(["home", "shop"] as const).map((kind) => {
              // The least dear open unit of each kind can be bought from here. Payment is in SOL, from the buyer's own wallet.
              const open = unitsOf(db, row.buildId).filter((unit) => unit.kind === kind && unit.status === "open").map((unit) => ({ unit, ask: askOf(db, unit) })).sort((p, q) => p.ask.priceCents - q.ask.priceCents)[0];
              return open ? (
                <form action={unitQuote} key={kind}>
                  <input type="hidden" name="unit" value={open.unit.id} />
                  <button type="submit">{`Buy ${open.unit.address.split(", ")[1]} for ${money(open.ask.priceCents)}`}</button>
                </form>
              ) : null;
            })}
            {row.shopkeepers.length ? <p className="muted">Trading here: {row.shopkeepers.map((shop) => `${shop.holder} (${shop.address})`).join(", ")}</p> : null}
          </article>
        ))}
      </div>
    </div>
  );
}
