import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { OWNER_COOKIE } from "../../../../auth/owner";
import { loginReachable, ownerRouteOpen } from "../../../../auth/publicMode";
import { blankPlan, FIELD_LABELS, figures, getPlan, planGaps, readiness, TEXT_FIELDS } from "../../../../economy/plans";
import { getVenture, scorecard } from "../../../../economy/ventures";
import { printFacts } from "../../../../fulfillment/pod";
import { getEngine } from "../../../../server/engine";
import { shopCheckoutOpen } from "../../../../shop/store";
import { ventureCheckAction, ventureLaunchAction, venturePlanAction } from "../../../actions";

function money(cents: number | null): string {
  if (cents == null) return "not known yet";
  return `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function typed(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

export default async function VenturePlan({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const header = await headers();
  if (!loginReachable(header.get("fly-client-ip"), process.env, header.get("x-lumen-desk"))) notFound();
  const jar = await cookies();
  const token = jar.get(OWNER_COOKIE)?.value ?? null;
  const engine = getEngine();
  const authed = engine.authed(`${OWNER_COOKIE}=${encodeURIComponent(token ?? "")}`);
  if (!authed || !ownerRouteOpen("/admin", authed)) redirect("/admin/login");
  const venture = /^[a-z0-9-]{2,40}$/.test(id) ? getVenture(engine.db, id) : null;
  if (!venture) notFound();
  const now = Date.now();
  const plan = getPlan(engine.db, venture.id) ?? blankPlan();
  const sums = figures(plan);
  const card = scorecard(engine.db, venture.id, now);
  const state = readiness(engine.db, venture.id, { ...printFacts(engine.db, engine.env, shopCheckoutOpen(engine.db, engine.env), venture.id), kind: venture.kind });
  const setupGaps = planGaps(plan, "setup");
  return (
    <div className="grid">
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <p className="kicker">{venture.kind} · {venture.status} · proposed by {venture.proposedBy}</p>
        <h1>{venture.name}</h1>
        <p><a href="/admin/ventures">Back to all ventures</a></p>
        {card.tainted ? <p className="muted">Marked: something from outside is behind this venture. It can never spend without you.</p> : null}
      </section>
      <section className="card">
        <p className="kicker">The dollars, worked out</p>
        <table>
          <tbody>
            <tr><th>Price</th><td>{money(plan.priceCents)}</td></tr>
            <tr><th>Shipping charged to the buyer</th><td>{money(plan.shippingChargeCents)}</td></tr>
            <tr><th>Buyer pays</th><td>{money(sums.takeCents)}</td></tr>
            <tr><th>Cost of one, made and sent</th><td>{money(plan.unitCostCents)}{plan.unitCostSource ? ` (${plan.unitCostSource === "estimate" ? "a guess" : plan.unitCostSource === "quoted" ? "from a real quote" : "your figure"})` : ""}</td></tr>
            <tr><th>Payment fee</th><td>{money(sums.feeCents)}</td></tr>
            <tr><th>Left from one sale</th><td>{money(sums.unitMarginCents)}{sums.marginPercent == null ? "" : ` (${sums.marginPercent}%)`}</td></tr>
            <tr><th>Cost to start</th><td>{money(sums.startupCents)}</td></tr>
            <tr><th>Cost to run, per month</th><td>{money(sums.monthlyCents)}</td></tr>
            <tr><th>Sales to pay that back</th><td>{sums.breakEvenUnits ?? "not known yet"}</td></tr>
            <tr><th>First-month target</th><td>{plan.targetUnits ?? "not set"}</td></tr>
            <tr><th>First month at target, taken in</th><td>{money(sums.monthOneRevenueCents)}</td></tr>
            <tr><th>First month at target, after all costs</th><td>{money(sums.monthOneResultCents)}</td></tr>
            <tr><th>Most it can lose in month one</th><td>{money(sums.worstCaseCents)}</td></tr>
            <tr><th>Budget asked for</th><td>{money(plan.budgetAskCents)} over {plan.daysAsk} days</td></tr>
          </tbody>
        </table>
        <p className="muted">These are arithmetic on the plan below. So far, for real: {money(card.incomeCents)} in, {money(card.expenseCents)} out.</p>
      </section>
      <section className="card">
        <p className="kicker">Day-one list</p>
        {venture.status === "proposed" && setupGaps.length ? <p className="muted">Before it can be approved: {setupGaps.map((gap) => gap.say).join(" ")}</p> : null}
        {state.gaps.length ? <p className="muted">Before it can launch: {state.gaps.map((gap) => gap.say).join(" ")}</p> : null}
        <table>
          <tbody>
            {state.items.map((item) => (
              <tr key={item.key}>
                <th>{item.done ? "Done" : "Not yet"}</th>
                <td>{item.say}</td>
                <td>
                  {item.by === "owner" ? (
                    <form action={ventureCheckAction}>
                      <input type="hidden" name="id" value={venture.id} />
                      <input type="hidden" name="key" value={item.key} />
                      <button type="submit" name="done" value={item.done ? "no" : "yes"}>{item.done ? "Untick" : "I checked, it is done"}</button>
                    </form>
                  ) : "checked by the engine"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {venture.status === "setup" ? (
          <form action={ventureLaunchAction}>
            <input type="hidden" name="id" value={venture.id} />
            <button type="submit" disabled={!state.ready}>{state.ready ? "Launch it" : "Not ready to launch"}</button>
          </form>
        ) : null}
      </section>
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <p className="kicker">The plan</p>
        <form action={venturePlanAction}>
          <input type="hidden" name="id" value={venture.id} />
          {TEXT_FIELDS.map((field) => (
            <label key={field}>{FIELD_LABELS[field]} <textarea name={field} maxLength={400} rows={2} defaultValue={plan[field]} /></label>
          ))}
          <label>Price in dollars <input name="price" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" defaultValue={typed(plan.priceCents)} /></label>
          <label>Shipping charged to the buyer <input name="shippingCharge" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" defaultValue={typed(plan.shippingChargeCents)} /></label>
          <label>Cost of one, made and sent <input name="unitCost" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" defaultValue={typed(plan.unitCostCents)} /></label>
          <label><input type="checkbox" name="costIsGuess" value="yes" defaultChecked={plan.unitCostSource === "estimate"} /> That cost is a guess</label>
          <label>Payment fee, percent <input name="feePercent" inputMode="decimal" pattern="[0-9]{1,2}(\.[0-9]{1,2})?" defaultValue={(plan.feeBasisPoints / 100).toString()} /></label>
          <label>Payment fee, fixed part in dollars <input name="feeFixed" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" defaultValue={typed(plan.feeFixedCents)} /></label>
          <label>Costs to start, one per line as &quot;what, dollars&quot; <textarea name="startup" rows={3} defaultValue={plan.startup.map((line) => `${line.label}, ${typed(line.cents)}`).join("\n")} /></label>
          <label>Costs to run each month, one per line <textarea name="monthly" rows={3} defaultValue={plan.monthly.map((line) => `${line.label}, ${typed(line.cents)}`).join("\n")} /></label>
          <label>First-month target, in sales <input name="targetUnits" inputMode="numeric" pattern="[0-9]{1,7}" defaultValue={plan.targetUnits ?? ""} /></label>
          <label>Budget asked for, in dollars <input name="budgetAsk" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" defaultValue={typed(plan.budgetAskCents)} /></label>
          <label>Days asked for <input name="daysAsk" inputMode="numeric" pattern="[0-9]{1,3}" defaultValue={plan.daysAsk} /></label>
          <button type="submit">Save the plan</button>
        </form>
      </section>
    </div>
  );
}
