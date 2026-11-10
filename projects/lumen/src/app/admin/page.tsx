import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { OWNER_COOKIE } from "../../auth/owner";
import { loginReachable, ownerRouteOpen, publicModeOn } from "../../auth/publicMode";
import { IssueWorldToken } from "../../components/IssueWorldToken";
import { artAction, clearAlertAction, controlAction, creativeAction, logout, proposalAction, reconcileAction, resolveUnknownAction, sendChat, wishAction } from "../actions";
import { deskClock } from "../../money/notify";
import { getEngine } from "../../server/engine";

export default async function AdminPage() {
  const jar = await cookies();
  const token = jar.get(OWNER_COOKIE)?.value ?? null;
  const authed = getEngine().authed(`${OWNER_COOKIE}=${encodeURIComponent(token ?? "")}`);
  if (!authed || !ownerRouteOpen("/admin", authed)) {
    if (!loginReachable((await headers()).get("host"))) notFound();
    redirect("/admin/login");
  }
  const publicMode = publicModeOn();
  const engine = getEngine();
  const snap = engine.snapshot();
  const creative = engine.creativeBoard();
  return (
    <div className="grid">
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <p className="kicker">Keeper desk</p>
        <h1>Zoora, in private</h1>
        <p>{snap.feeling}</p>
        {snap.money.notifierConfigured ? null : <p className="warn">No email or Telegram notifier is configured. Alerts stay on this desk only.</p>}
        {snap.money.autoPaused ? (
          <div className="banner">
            Automatic spending and approvals are paused.
            {snap.money.reconciliationAlert ? " Reconciliation mismatch." : ""}
            {snap.money.openDispute ? " A dispute is open." : ""}
            {snap.money.reconciliationAlert ? <form action={clearAlertAction}><button type="submit">Clear reconciliation alert</button></form> : null}
          </div>
        ) : null}
        {snap.money.alerts.length ? (
          <ul className="feed">
            {snap.money.alerts.map((alert) => (
              <li key={alert.id}><strong>{alert.title}</strong> — {alert.detail} <span className="muted">{deskClock(alert.created_at)}</span></li>
            ))}
          </ul>
        ) : null}
        <p>{publicMode ? "Spending stays off while the island is public." : `Kill switch: ${snap.money.kill ? "ON" : "off"} · Spend: ${snap.money.spendOpen ? "open" : `closed (${snap.money.spendReason})`} · Sales: ${snap.money.sales}`}</p>
        <div className="row">
          <form action={controlAction}><input type="hidden" name="key" value="kill" /><input type="hidden" name="value" value={snap.money.kill ? "0" : "1"} /><button type="submit">{snap.money.kill ? "Release kill switch" : "Kill switch"}</button></form>
          <form action={controlAction}><input type="hidden" name="key" value="spend" /><input type="hidden" name="value" value="1" /><button type="submit">Enable spend toggle</button></form>
          <form action={controlAction}><input type="hidden" name="key" value="spend" /><input type="hidden" name="value" value="0" /><button type="submit">Disable spend toggle</button></form>
          <form action={reconcileAction}><button type="submit">Run reconciliation</button></form>
          <form action={logout}><button type="submit">Log out</button></form>
          {publicMode ? null : <a className="button" href="/admin/ledger">Balance and P&amp;L</a>}
        </div>
      </section>
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <h2>World tokens</h2>
        <p className="muted">One token, one agent. Joining the island does not approve a purchase.</p>
        <IssueWorldToken />
        {(snap.money.unknownClaims as { intentId: string; amountCents: number }[]).length ? (
          <div>
            <h3>Unknown charges</h3>
            <p className="muted">Mark whether the card was charged. This does not call the issuer again.</p>
            <ul className="feed">
              {(snap.money.unknownClaims as { intentId: string; amountCents: number; atMs: number; merchant: string }[]).map((claim) => (
                <li key={claim.intentId}>
                  <strong>{claim.merchant}</strong> · {claim.amountCents}¢ · {deskClock(claim.atMs)}
                  <form action={resolveUnknownAction}>
                    <input type="hidden" name="intentId" value={claim.intentId} />
                    <input type="hidden" name="verdict" value="charged" />
                    <input name="providerTransactionId" placeholder="Issuer transaction id" />
                    <label><input type="checkbox" name="unknownId" value="1" /> Id unknown</label>
                    <label><input type="checkbox" name="confirm" value="1" required /> Confirm charged</label>
                    <button type="submit">Mark charged</button>
                  </form>
                  <form action={resolveUnknownAction}>
                    <input type="hidden" name="intentId" value={claim.intentId} />
                    <input type="hidden" name="verdict" value="not_charged" />
                    <label><input type="checkbox" name="confirm" value="1" required /> Confirm not charged</label>
                    <button type="submit">Mark not charged</button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
      <section className="card">
        <h2>Talk with Zoora</h2>
        <form action={sendChat}>
          <textarea name="text" placeholder="Ask what it wants. It will not spend from this box." maxLength={500} />
          <button type="submit">Send</button>
        </form>
        <ul className="feed">
          {(snap.chat as { author: string; body: string; reply: string | null; status: string }[]).map((row, index) => (
            <li key={index}>
              <strong>{row.author === "jarvis" ? "Zoora system" : row.author}</strong>: {row.body}
              {row.reply ? <div className="muted">Zoora: {row.reply}</div> : <div className="muted">{row.status}</div>}
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>Wants</h2>
        <ul className="feed">
          {snap.wants.map((want) => (
            <li key={want.id}><strong>{want.text}</strong><div className="muted">{want.need}: {want.reason}</div></li>
          ))}
        </ul>
        <h2>Wishlist for the keeper</h2>
        <p className="muted">Estimates are guesses, never ledger facts. Approve submits a purchase intent to the policy engine. It does not skip it.</p>
        <ul className="feed">
          {snap.wishes.map((wish) => (
            <li key={wish.id}>
              <strong>{wish.item}</strong> · {wish.priority} · {wish.status}
              <div>{wish.why}</div>
              <div className="muted">{wish.earnHow}</div>
              <div>{wish.estimateCents == null ? "Estimate: none. Zoora will not invent a price." : `Estimate (guess, not from the ledger): $${(wish.estimateCents / 100).toFixed(2)}`}</div>
              {wish.status === "open" || wish.status === "asked_more" ? (
                <div className="row">
                  <form action={wishAction}><input type="hidden" name="id" value={wish.id} /><input type="hidden" name="action" value="approve" /><button type="submit">Approve</button></form>
                  <form action={wishAction}><input type="hidden" name="id" value={wish.id} /><input type="hidden" name="action" value="decline" /><button type="submit">Decline</button></form>
                  <form action={wishAction}><input type="hidden" name="id" value={wish.id} /><input type="hidden" name="action" value="ask" /><button type="submit">Ask more</button></form>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <h2>Art reactions and listings</h2>
        <div className="gallery">
          {snap.gallery.slice(0, 6).map((item) => {
            const art = item as { id: string; title: string };
            return (
              <article key={art.id}>
                <strong>{art.title}</strong>
                <div className="row">
                  <form action={artAction}><input type="hidden" name="id" value={art.id} /><input type="hidden" name="kind" value="like" /><button type="submit">Like</button></form>
                  <form action={artAction}><input type="hidden" name="id" value={art.id} /><input type="hidden" name="kind" value="favorite" /><button type="submit">Favorite</button></form>
                  <form action={artAction}><input type="hidden" name="id" value={art.id} /><input type="hidden" name="kind" value="pass" /><button type="submit">Pass</button></form>
                </div>
              </article>
            );
          })}
        </div>
        <ul className="feed">
          {(snap.money.proposals as { id: string; kind: string; status: string; payload: string }[]).map((proposal) => (
            <li key={proposal.id}>
              {proposal.kind} · {proposal.status} · {proposal.payload}
              {proposal.status === "proposed" ? (
                <form action={proposalAction}><input type="hidden" name="id" value={proposal.id} /><button type="submit">Approve proposal</button></form>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <h2>Creative building</h2>
        <p className="muted">Zoora spends island materials, not money. {creative.left} materials left today. Building is {creative.on ? "on" : "off"}.</p>
        <form action={creativeAction}>
          <input type="hidden" name="op" value={creative.on ? "off" : "on"} />
          <button type="submit">{creative.on ? "Turn creative building off" : "Turn creative building on"}</button>
        </form>
        <ul className="feed">
          {creative.builds.map((build) => (
            <li key={build.id}>
              <strong>{build.title}</strong> · {build.kind} · {build.placeId} · v{build.version} · {build.status}
              <p>{build.why}</p>
              {build.status === "placed" ? (
                <form action={creativeAction}>
                  <input type="hidden" name="op" value="hide" />
                  <input type="hidden" name="id" value={build.id} />
                  <button type="submit">Hide</button>
                </form>
              ) : null}
              {build.status !== "undone" ? (
                <form action={creativeAction}>
                  <input type="hidden" name="op" value="undo" />
                  <input type="hidden" name="id" value={build.id} />
                  <button type="submit">Undo</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
