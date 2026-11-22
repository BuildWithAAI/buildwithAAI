import React from "react";
import { FLOOR_NOTES, REAL_MONEY, publicHistory, publicQuotes, type FloorBoard, type FloorFx } from "../trading/public";

export type { FloorBoard } from "../trading/public";

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function sol(micro: number): string {
  const sign = micro < 0 ? "-" : "";
  return `${sign}${(Math.abs(micro) / 1_000_000).toFixed(4)} SOL`;
}

function closedLine(result: string | null): string {
  if (!result) return "Still open.";
  try {
    const parsed = JSON.parse(result) as { usdCents?: number; solMicro?: number };
    if (typeof parsed.usdCents === "number") return `Closed ${money(parsed.usdCents)} · ${sol(parsed.solMicro ?? 0)}.`;
  } catch { /* a stored result that is not a total stays off the page */ }
  return "Closed.";
}

/** Where one forex order stands, in the broker's own figures. */
function fxLine(order: FloorFx): string {
  if (order.status === "sending") return "On its way to the broker.";
  if (order.status === "resting") return "Waiting at the broker for its price.";
  if (order.status === "open") return `In the trade from ${order.fill ?? order.limit}.`;
  if (order.status === "cancelled") return "Cancelled. It was not filled.";
  const how = order.exitWhy === "stop" ? " at its stop" : order.exitWhy === "target" ? " at its target" : "";
  const result = order.resultCents == null ? "" : ` ${money(order.resultCents)}.`;
  return `Closed${how}${order.exit ? `, ${order.exit}` : ""}.${result}`;
}

export function FloorView({ board, now }: { board: FloorBoard; now: number }) {
  const quotes = publicQuotes(board.quotes, now);
  const history = publicHistory(board.history, board.quotes, now);
  return (
    <div>
      <p className="kicker">{board.forexLive || board.coinsLive ? "LIVE" : "CLOSED"}</p>
      <h1>Zoora&apos;s trading floor</h1>
      <p className="muted">{REAL_MONEY} {FLOOR_NOTES}</p>
      <p className="muted">Forex is {board.forexLive ? "connected to the broker" : "not connected"}. Coins are {board.coinsLive ? "connected to the signer" : "not connected"}.</p>
      <section className="card">
        <h2>Forex</h2>
        {board.forex.length === 0 ? <p>No forex order yet.</p> : null}
        <ul className="feed">
          {board.forex.map((order) => (
            <li key={`${order.pair}-${order.createdAt}`}>{order.mode === "live" ? "LIVE" : "DEMO"} {order.side} {order.pair} {order.lots} lot. Limit {order.limit}, stop {order.stop}, target {order.target}. {fxLine(order)} Entered because {order.thesis} {new Date(order.createdAt).toISOString()}</li>
          ))}
        </ul>
        <p>Forex P&amp;L {money(board.forexPnlCents)}. {REAL_MONEY}</p>
        {board.forex.some((order) => order.mode === "demo") ? <p className="muted">A row marked DEMO was placed on a broker&apos;s practice account. It is not real money and it is not counted.</p> : null}
      </section>
      <section className="card" style={{ marginTop: "1rem" }}>
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
        {board.positions.length === 0 ? <p>No open position.</p> : null}
        <ul className="feed">
          {board.positions.map((row) => <li key={row.symbol}>{row.symbol} · {money(row.usdCents)} · {sol(row.solMicro)}</li>)}
        </ul>
        <p>Coins P&amp;L {money(board.pnl.usdCents)} · {sol(board.pnl.solMicro)}. {REAL_MONEY}</p>
      </section>
      <section className="card" style={{ marginTop: "1rem" }}>
        <h2>Results</h2>
        <ul className="feed">
          {history.map((row) => (
            <li key={`${row.symbol}-${row.quotedAt}`}>LIVE {row.side} {row.symbol}. Entered because {row.thesis} Exit plan: {row.exitPlan} {closedLine(row.result)} {new Date(row.quotedAt).toISOString()}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
