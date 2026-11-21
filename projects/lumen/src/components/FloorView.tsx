import React from "react";
import { PAPER_ASSUMPTIONS, SIMULATED, publicHistory, publicQuotes } from "../trading/public";

export type FloorBoard = {
  mode: "PAPER" | "LIVE";
  showLivePnl: boolean;
  quotes: { symbol: string; priceUsd: string; priceSol: string; quotedAt: number; pairCreatedAt: number | null }[];
  positions: { symbol: string; usdCents: number; solMicro: number }[];
  history: { symbol: string; side: string; result: string | null; thesis: string; exitPlan: string; quotedAt: number; mode: string }[];
  pnl: { paperUsdCents: number; paperSolMicro: number; liveUsdCents: number; liveSolMicro: number };
};

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function closedLine(result: string | null): string {
  if (!result) return "Still open.";
  try {
    const parsed = JSON.parse(result) as { usdCents?: number; solMicro?: number };
    if (typeof parsed.usdCents === "number") return `Closed ${money(parsed.usdCents)} · ${sol(parsed.solMicro ?? 0)}. ${SIMULATED}`;
  } catch { /* a stored result that is not a total stays off the page */ }
  return `Closed. ${SIMULATED}`;
}

function sol(micro: number): string {
  const sign = micro < 0 ? "-" : "";
  return `${sign}${(Math.abs(micro) / 1_000_000).toFixed(4)} SOL`;
}

export function FloorView({ board, now }: { board: FloorBoard; now: number }) {
  const quotes = publicQuotes(board.quotes, now);
  const history = publicHistory(board.history, board.quotes, now).filter((row) => board.mode === "LIVE" || row.mode !== "live");
  const label = board.mode === "LIVE" ? "LIVE" : "PAPER";
  return (
    <div>
      <p className="kicker">{label}</p>
      <h1>{board.mode === "LIVE" ? "Zoora's trading floor" : "Zoora's paper trading floor"}</h1>
      <p className="muted">{label}. {SIMULATED} {PAPER_ASSUMPTIONS}</p>
      <section className="card">
        <h2>Quotes</h2>
        {quotes.length === 0 ? <p>No public quote yet.</p> : null}
        <ul className="feed">
          {quotes.map((quote) => (
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
        <p>Paper P&amp;L {money(board.pnl.paperUsdCents)} · {sol(board.pnl.paperSolMicro)}. {SIMULATED}</p>
        {board.showLivePnl ? <p>Live P&amp;L {money(board.pnl.liveUsdCents)} · {sol(board.pnl.liveSolMicro)}. {SIMULATED}</p> : null}
      </section>
      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Results</h2>
        <ul className="feed">
          {history.map((row) => (
            <li key={`${row.symbol}-${row.quotedAt}`}>{row.mode === "live" ? "LIVE" : "PAPER"} {row.side} {row.symbol}. Entered because {row.thesis} Exit plan: {row.exitPlan} {closedLine(row.result)} {new Date(row.quotedAt).toISOString()}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
