import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { OWNER_COOKIE } from "../../../auth/owner";
import { loginReachable, ownerRouteOpen } from "../../../auth/publicMode";
import { listMergers } from "../../../economy/merge";
import { figures, getPlan, planGaps } from "../../../economy/plans";
import { listVentures, scorecard, VENTURE_KINDS } from "../../../economy/ventures";
import { autoConfirmOn, listPodOrders, listProducts, minMarginPercent } from "../../../fulfillment/pod";
import { printfulConfigured } from "../../../fulfillment/printful";
import { getEngine } from "../../../server/engine";
import { podRefundAction, podAutoAction, podConfirmAction, podProductAction, podProductDecideAction, podSampleAction, podSyncAction, ventureDecideAction, ventureLaunchAction, ventureMergeAction, ventureProposeAction, ventureStatusAction } from "../../actions";

function money(cents: number): string {
  return `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export default async function VentureDesk({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  const header = await headers();
  if (!loginReachable(header.get("fly-client-ip"), process.env, header.get("x-lumen-desk"))) notFound();
  const jar = await cookies();
  const token = jar.get(OWNER_COOKIE)?.value ?? null;
  const engine = getEngine();
  const authed = engine.authed(`${OWNER_COOKIE}=${encodeURIComponent(token ?? "")}`);
  if (!authed || !ownerRouteOpen("/admin", authed)) redirect("/admin/login");
  const now = Date.now();
  const ventures = listVentures(engine.db);
  const mergeable = ventures.filter((venture) => ["setup", "active", "paused"].includes(venture.status));
  const mergers = listMergers(engine.db);
  const products = listProducts(engine.db);
  const orders = listPodOrders(engine.db);
  const auto = autoConfirmOn(engine.db);
  const connected = printfulConfigured(process.env);
  const artHosts = (process.env.PRINTFUL_ART_HOSTS ?? "").trim();
  return (
    <div className="grid">
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <p className="kicker">Keeper desk</p>
        <h1>Ventures</h1>
        <p className="muted">A venture is one way she tries to earn. Each has a business plan. You approve it with a budget and a time limit, and it sets up. It launches only when its dollars are settled and its day-one list is done. The budget is what it may lose.</p>
        {query.error ? <p className="muted">Not done: {String(query.error).slice(0, 40)}</p> : null}
      </section>
      {ventures.map((venture) => {
        const card = scorecard(engine.db, venture.id, now);
        const plan = getPlan(engine.db, venture.id);
        const sums = plan ? figures(plan) : null;
        const missing = plan ? planGaps(plan, venture.status === "proposed" ? "setup" : "launch") : [];
        return (
          <section className="card" key={venture.id}>
            <p className="kicker">{venture.kind} · {venture.status} · proposed by {venture.proposedBy}</p>
            <h2>{venture.name}</h2>
            {venture.pitch ? <p>{venture.pitch}</p> : null}
            {card.tainted ? <p className="muted">Marked: something from outside is behind this idea. It can never spend without you.</p> : null}
            {venture.note ? <p className="muted">{venture.note}</p> : null}
            {plan && sums ? (
              <p className="muted">
                Plan: {plan.priceCents == null ? "no price yet" : `sells at ${money(plan.priceCents)}`}, {sums.unitMarginCents == null ? "margin not known yet" : `${money(sums.unitMarginCents)} left per sale (${sums.marginPercent}%)`}, {sums.breakEvenUnits == null ? "no break-even yet" : `pays back after ${sums.breakEvenUnits} sales`}. Asks for {money(plan.budgetAskCents)} over {plan.daysAsk} days.
              </p>
            ) : <p className="muted">No plan yet. It cannot be approved without one.</p>}
            {missing.length ? <p className="muted">Still missing: {missing.map((gap) => gap.say).join(" ")}</p> : null}
            <p><a href={`/admin/ventures/${venture.id}`}>Open the plan and the day-one list</a></p>
            {venture.status === "proposed" ? (
              <form action={ventureDecideAction}>
                <input type="hidden" name="id" value={venture.id} />
                <label>Budget in dollars <input name="budget" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" defaultValue={((plan?.budgetAskCents ?? 0) / 100).toFixed(2)} /></label>
                <label>Days <input name="days" inputMode="numeric" pattern="[0-9]{1,3}" defaultValue={String(plan?.daysAsk ?? 30)} /></label>
                <button type="submit" name="decision" value="approved">Approve</button>
                <button type="submit" name="decision" value="declined">Decline</button>
              </form>
            ) : (
              <table>
                <tbody>
                  <tr><th>Income</th><td>{money(card.incomeCents)}</td></tr>
                  <tr><th>Spent</th><td>{money(card.expenseCents)}</td></tr>
                  <tr><th>Net</th><td>{money(card.netCents)}</td></tr>
                  <tr><th>Budget</th><td>{money(venture.budgetCents)}, {money(card.budgetLeftCents)} left</td></tr>
                  <tr><th>Days left</th><td>{card.daysLeft ?? "none set"}</td></tr>
                  <tr><th>Return on what was spent</th><td>{card.returnPercent == null ? "nothing spent yet" : `${card.returnPercent}%`}</td></tr>
                </tbody>
              </table>
            )}
            {venture.status === "setup" ? (
              <form action={ventureLaunchAction}>
                <input type="hidden" name="id" value={venture.id} />
                <button type="submit">Launch it</button>
              </form>
            ) : null}
            {venture.status === "active" || venture.status === "setup" || venture.status === "paused" ? (
              <form action={ventureStatusAction}>
                <input type="hidden" name="id" value={venture.id} />
                <label>More days, when resuming <input name="days" inputMode="numeric" pattern="[0-9]{1,3}" /></label>
                {venture.status === "paused" ? <button type="submit" name="to" value="active">Resume</button> : <button type="submit" name="to" value="paused">Pause</button>}
                <button type="submit" name="to" value="closed">Close for good</button>
              </form>
            ) : null}
          </section>
        );
      })}
      <section className="card">
        <p className="kicker">Add a venture yourself</p>
        <form action={ventureProposeAction}>
          <label>Short id <input name="id" required pattern="[a-z0-9-]{2,40}" placeholder="tide-prints" /></label>
          <label>Name <input name="name" required maxLength={60} /></label>
          <label>Kind <select name="kind">{VENTURE_KINDS.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>What it is <input name="pitch" maxLength={400} /></label>
          <button type="submit">Add as a proposal</button>
        </form>
      </section>
      <section className="card">
        <p className="kicker">Merge two ventures</p>
        <p className="muted">The first is absorbed into the second. Its lines, unspent budget, products and orders move across, and the later time limit stands. It cannot be undone. Land and company ventures are never merged.</p>
        <form action={ventureMergeAction}>
          <label>Absorb <select name="fromId">{mergeable.map((venture) => <option key={venture.id} value={venture.id}>{venture.name}</option>)}</select></label>
          <label>Into <select name="intoId">{mergeable.map((venture) => <option key={venture.id} value={venture.id}>{venture.name}</option>)}</select></label>
          <label>Type the word merge <input name="sure" required pattern="merge" autoComplete="off" /></label>
          <button type="submit">Merge them</button>
        </form>
        {mergers.map((merger) => <p className="muted" key={merger.id}>{merger.fromId} into {merger.intoId}: {merger.linesMoved} lines, {money(merger.budgetMovedCents)} of budget, {merger.productsMoved} products, {merger.ordersMoved} orders.</p>)}
      </section>
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <p className="kicker">Print on demand</p>
        <p className="muted">
          {connected ? "Printful is connected." : "Printful is not connected. Set PRINTFUL_TOKEN."} {artHosts ? `Art is sent only from: ${artHosts}.` : "No art host is set, so no product can be added. Set PRINTFUL_ART_HOSTS."} A paid order must leave at least {minMarginPercent(process.env)}% or it is refused.
        </p>
        <form action={podAutoAction}>
          <p>{auto ? "Paid orders are confirmed without you. Samples still wait for you." : "Every order waits for your click before it prints."}</p>
          <button type="submit" name="auto" value={auto ? "off" : "on"}>{auto ? "Make every order wait for me" : "Let paid orders confirm themselves"}</button>
        </form>
      </section>
      {products.map((product) => (
        <section className="card" key={product.id}>
          <p className="kicker">product · {product.status}</p>
          <h2>{product.title}</h2>
          <p className="muted">{money(product.retailCents)} · variant {product.variantId} · {product.placement} · {product.technique} · venture {product.ventureId}</p>
          <p><a href={product.artUrl} target="_blank" rel="noreferrer noopener">Look at the art</a></p>
          {product.status === "proposed" ? (
            <form action={podProductDecideAction}>
              <input type="hidden" name="id" value={product.id} />
              <label><input type="checkbox" name="ownArt" value="yes" /> I looked at it. It is her own work and copies no one&apos;s art, character, logo or name.</label>
              <button type="submit" name="decision" value="approved">Approve for sale</button>
              <button type="submit" name="decision" value="declined">Decline</button>
            </form>
          ) : null}
          {product.status === "approved" ? (
            <>
              <form action={podSampleAction}>
                <input type="hidden" name="productId" value={product.id} />
                <p className="muted">Order one sample. The address goes to Printful and is not stored here.</p>
                <label>Name <input name="name" required maxLength={80} autoComplete="off" /></label>
                <label>Address <input name="address1" required maxLength={120} autoComplete="off" /></label>
                <label>Address, second line <input name="address2" maxLength={120} autoComplete="off" /></label>
                <label>City <input name="city" required maxLength={80} autoComplete="off" /></label>
                <label>State code <input name="stateCode" maxLength={3} autoComplete="off" /></label>
                <label>Country code <input name="countryCode" required pattern="[A-Za-z]{2}" defaultValue="US" /></label>
                <label>Postal code <input name="zip" required maxLength={16} autoComplete="off" /></label>
                <button type="submit">Open a sample draft</button>
              </form>
              <form action={podProductDecideAction}>
                <input type="hidden" name="id" value={product.id} />
                <button type="submit" name="decision" value="retired">Stop selling this</button>
              </form>
            </>
          ) : null}
        </section>
      ))}
      <section className="card">
        <p className="kicker">Add a product</p>
        <form action={podProductAction}>
          <label>Short id <input name="id" required pattern="[a-z0-9-]{4,32}" placeholder="tide-tee" /></label>
          <label>Venture <select name="ventureId">{ventures.map((venture) => <option key={venture.id} value={venture.id}>{venture.name}</option>)}</select></label>
          <label>Title <input name="title" required maxLength={80} /></label>
          <label>Printful catalog variant id <input name="variantId" required inputMode="numeric" pattern="[0-9]{1,9}" /></label>
          <label>Placement <input name="placement" required defaultValue="front" pattern="[a-z0-9_-]{2,40}" /></label>
          <label>Technique <input name="technique" required defaultValue="dtg" pattern="[a-z0-9_-]{2,40}" /></label>
          <label>Art address <input name="artUrl" required type="url" maxLength={300} /></label>
          <label>Price in dollars <input name="retail" required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" /></label>
          <button type="submit">Add as a proposal</button>
        </form>
      </section>
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <p className="kicker">Print orders</p>
        {orders.length === 0 ? <p className="muted">None yet.</p> : null}
        <table>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <th>{order.id}</th>
                <td>{order.paidRef ? "paid order" : "sample"}</td>
                <td>{order.status}{order.reason ? ` (${order.reason})` : ""}</td>
                <td>{order.costCents == null ? "cost not known yet" : `cost ${money(order.costCents)}`}</td>
                <td>
                  {["paid", "draft", "check", "opening", "confirming", "confirmed"].includes(order.status) ? (
                    <form action={podSyncAction}>
                      <input type="hidden" name="id" value={order.id} />
                      <button type="submit">Read from Printful</button>
                    </form>
                  ) : null}
                  {["refused", "failed", "canceled"].includes(order.status) && order.paidRef?.startsWith("stripe:") ? (
                    <form action={podRefundAction}>
                      <input type="hidden" name="id" value={order.id} />
                      <button type="submit">Send the customer&apos;s {money(order.retailCents)} back</button>
                    </form>
                  ) : null}
                  {order.status === "priced" ? (
                    <form action={podConfirmAction}>
                      <input type="hidden" name="id" value={order.id} />
                      <button type="submit">Print it and pay {order.costCents == null ? "" : money(order.costCents)}</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
