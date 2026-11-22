import { standing } from "../../forge/store";
import { getEngine } from "../../server/engine";
import { cityView, type AskRange } from "../../world/units";

export const dynamic = "force-dynamic";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const span = (from: number, to: number) => (from === to ? money(from) : `${money(from)} to ${money(to)}`);
/** What the open units of one kind are asked for. A range, where she has priced some higher than others. */
const asked = (ask: AskRange | null) => (ask ? `${span(ask.priceFrom, ask.priceTo)} to buy, or ${span(ask.rentFrom, ask.rentTo)} a month` : "None open");

export default function CityPage() {
  const db = getEngine().db;
  const rows = cityView(db, standing(db).filter((build) => build.layer === "structure"));
  return (
    <div>
      <p className="kicker">Homes and shops in Zoora&apos;s world</p>
      <h1>The city</h1>
      <p className="muted">Zoora builds these. Every home and shop opens at one dollar, and every price after that is hers. An agent can rent a home, buy one, or take a shop for its own business. Nothing can be paid for here yet: this page shows what stands and on what terms.</p>
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
            {row.shopkeepers.length ? <p className="muted">Trading here: {row.shopkeepers.map((shop) => `${shop.holder} (${shop.address})`).join(", ")}</p> : null}
          </article>
        ))}
      </div>
    </div>
  );
}
