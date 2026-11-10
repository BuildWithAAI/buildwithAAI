import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { OWNER_COOKIE } from "../../auth/owner";
import { loginReachable, ownerRouteOpen, publicModeOn } from "../../auth/publicMode";
import { loadIdentity } from "../../identity/load";
import { IssueWorldToken } from "../../components/IssueWorldToken";
import { artAction, clearAlertAction, controlAction, creativeAction, goalDesk, logout, proposalAction, reconcileAction, refundAction, resolveUnknownAction, sendChat, shopDesk, wishAction } from "../actions";
import { deskClock } from "../../money/notify";
import { getEngine } from "../../server/engine";

export default async function AdminPage() {
  const jar = await cookies();
  const token = jar.get(OWNER_COOKIE)?.value ?? null;
  const authed = getEngine().authed(`${OWNER_COOKIE}=${encodeURIComponent(token ?? "")}`);
  if (!authed || !ownerRouteOpen("/admin", authed)) {
    if (!loginReachable((await headers()).get("fly-client-ip"))) notFound();
    redirect("/admin/login");
  }
  const publicMode = publicModeOn();
  const engine = getEngine();
  const snap = engine.snapshot();
  const creative = engine.creativeBoard();
  const telegram = engine.telegramBoard();
  const shop = engine.shopBoard();
  const goals = engine.goals();
  const soul = loadIdentity();
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
          <form action={controlAction}><input type="hidden" name="key" value="trading_kill" /><input type="hidden" name="value" value={snap.money.tradingKill ? "0" : "1"} /><button type="submit">{snap.money.tradingKill ? "Release trading kill" : "Trading kill"}</button></form>
          {snap.money.tradingUnknown ? <form action={controlAction}><input type="hidden" name="key" value="trading_clear" /><input type="hidden" name="value" value="1" /><button type="submit">Clear trading pause</button></form> : null}
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
        <h2>Soul and goals</h2>
        <p className="muted">The soul is owner-authored. Zoora can read it and cannot change the boundaries.</p>
        <ul className="feed">
          {soul.boundaries.slice(0, 4).map((line) => <li key={line}>{line}</li>)}
        </ul>
        <ul className="feed">
          {goals.map((goal) => (
            <li key={goal.id}>
              <strong>{goal.horizon}</strong> · {goal.source} · {goal.status}
              <p>{goal.text}</p>
              {goal.status === "proposed" ? (
                <form action={goalDesk}>
                  <input type="hidden" name="op" value="approve" />
                  <input type="hidden" name="id" value={goal.id} />
                  <button type="submit">Approve</button>
                </form>
              ) : null}
              <form action={goalDesk}>
                <input type="hidden" name="op" value="revert" />
                <input type="hidden" name="id" value={goal.id} />
                <button type="submit">Revert</button>
              </form>
              {goal.source === "owner" ? (
                <form action={goalDesk}>
                  <input type="hidden" name="op" value="edit" />
                  <input type="hidden" name="id" value={goal.id} />
                  <input name="text" defaultValue={goal.text} />
                  <button type="submit">Save owner line</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
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
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <h2>Shop</h2>
        <p className="muted">{shop.shop ? shop.shop.name : "No shop yet."} Checkout is {shop.checkout ? "open" : "coming soon"}. Approve before publish is {shop.approve ? "on" : "off"}. {shop.cap == null ? "No listing cap." : Number.isFinite(shop.cap) ? `Listing cap $${(shop.cap / 100).toFixed(2)}.` : "Listing cap is not a valid dollar amount."}</p>
        <div className="row">
          <form action={shopDesk}><input type="hidden" name="op" value="sales" /><input type="hidden" name="on" value="1" /><button type="submit">Allow checkout</button></form>
          <form action={shopDesk}><input type="hidden" name="op" value="sales" /><input type="hidden" name="on" value="0" /><button type="submit">Coming soon</button></form>
          <form action={shopDesk}><input type="hidden" name="op" value="kill" /><input type="hidden" name="on" value={shop.kill ? "0" : "1"} /><button type="submit">{shop.kill ? "Release shop kill switch" : "Shop kill switch"}</button></form>
          <form action={shopDesk}><input type="hidden" name="op" value="approve" /><input type="hidden" name="on" value={shop.approve ? "0" : "1"} /><button type="submit">{shop.approve ? "Publish without asking" : "Ask before publish"}</button></form>
        </div>
        <ul className="feed">
          {shop.listings.map((item) => (
            <li key={item.id}>
              <strong>{item.title}</strong> · {item.kind} · {item.status} · ${(item.priceCents / 100).toFixed(2)}
              <p>{item.description}</p>
              {item.status === "draft" ? <form action={shopDesk}><input type="hidden" name="op" value="publish" /><input type="hidden" name="id" value={item.id} /><button type="submit">Approve</button></form> : null}
              {item.status === "published" ? <form action={shopDesk}><input type="hidden" name="op" value="hide" /><input type="hidden" name="id" value={item.id} /><button type="submit">Hide</button></form> : null}
              {item.status !== "retired" ? <form action={shopDesk}><input type="hidden" name="op" value="retire" /><input type="hidden" name="id" value={item.id} /><button type="submit">Unpublish</button></form> : null}
            </li>
          ))}
        </ul>
        <form action={refundAction}>
          <input name="charge" placeholder="Charge id to refund" />
          <input name="key" placeholder="Idempotency key" />
          <button type="submit">Refund</button>
        </form>
        <h2>Zoora's messages</h2>
        <p className="muted">{telegram.mock ? "Mock mode. Zoora's thoughts stay here until the owner bot secrets are set." : "Zoora can write to the owner. Tokens are not shown here."} Alerts stay on email, or on a system channel if one is configured.</p>
        <ul className="feed">
          {telegram.thoughts.length ? telegram.thoughts.map((thought) => (
            <li key={`${thought.at_ms}-${thought.text.slice(0, 24)}`}>{thought.text}</li>
          )) : <li>Zoora has not written yet.</li>}
        </ul>
      </section>
    </div>
  );
}
