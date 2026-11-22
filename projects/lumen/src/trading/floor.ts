import type { DatabaseSync } from "node:sqlite";
import { tape, tradingLive, type TradeEnv } from "./book";
import { fxBridgeSet, fxResultCents, recentFxOrders } from "./forex";
import type { FloorBoard } from "./public";

/**
 * Her trading floor, read from her books: her forex orders and her coin trades, and whether each side can
 * reach its venue now. There is no paper trading, so every row is a real order or a real trade. A forex
 * row the broker says is on a practice account is marked `demo` and left out of the total.
 */
export function floorBoard(db: DatabaseSync, env: TradeEnv = process.env): FloorBoard {
  const coins = tape(db, env);
  return {
    forexLive: fxBridgeSet(env),
    coinsLive: coins.live,
    forex: recentFxOrders(db).map((order) => ({ mode: order.mode, pair: order.pair, side: order.side, lots: order.lots, limit: order.limit, stop: order.stop, target: order.target, status: order.status, fill: order.fill, exit: order.exit, exitWhy: order.exitWhy, resultCents: order.resultCents, thesis: order.thesis, createdAt: order.createdAt })),
    forexPnlCents: fxResultCents(db),
    quotes: coins.quotes,
    positions: coins.positions,
    history: coins.history,
    pnl: coins.pnl,
  };
}

/** True when an order of hers has somewhere real to go: the broker, through the bridge, or the coin signer. */
export function floorOpen(env: TradeEnv = process.env): boolean {
  return fxBridgeSet(env) || tradingLive(env);
}
