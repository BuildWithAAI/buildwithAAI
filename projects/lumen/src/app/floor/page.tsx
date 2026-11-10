import { tape } from "../../trading/book";
import { getEngine } from "../../server/engine";

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function sol(micro: number): string {
  const sign = micro < 0 ? "-" : "";
  return `${sign}${(Math.abs(micro) / 1_000_000).toFixed(4)} SOL`;
}

export default function FloorPage() {
  const board = tape(getEngine().db);
  return (
    <div>
      <p className="kicker">{board.mode}</p>
      <h1>Zoora's trading floor</h1>
      <p className="muted">{board.mode === "LIVE" ? "LIVE and paper books stay separate." : "PAPER."} These figures use stored public quotes. A missing quote is not a price. Nothing here is advice.</p>
      <section className="card">
        <h2>Quotes</h2>
        {board.quotes.length === 0 ? <p>No public quote yet.</p> : null}
        <ul className="feed">
          {board.quotes.map((quote) => (
            <li key={quote.symbol}>{quote.symbol} · {quote.priceUsd} USD · {quote.priceSol} SOL · {new Date(quote.quotedAt).toISOString()}</li>
          ))}
        </ul>
      </section>
      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Open positions</h2>
        {board.positions.length === 0 ? <p>No open paper position.</p> : null}
        <ul className="feed">
          {board.positions.map((row) => <li key={row.symbol}>{row.symbol} · {money(row.usdCents)} · {sol(row.solMicro)}</li>)}
        </ul>
        <p>Paper P&L {money(board.pnl.paperUsdCents)} · {sol(board.pnl.paperSolMicro)}</p>
        <p>Live P&L {money(board.pnl.liveUsdCents)} · {sol(board.pnl.liveSolMicro)}</p>
      </section>
      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Theses</h2>
        <ul className="feed">
          {board.history.map((row) => (
            <li key={`${row.symbol}-${row.quotedAt}`}>{row.mode} {row.side} {row.symbol}. Entered because {row.thesis} Exit plan: {row.exitPlan} {row.result ? `Result ${row.result}.` : "Still open."} {new Date(row.quotedAt).toISOString()}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
