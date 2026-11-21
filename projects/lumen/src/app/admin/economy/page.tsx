import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { OWNER_COOKIE } from "../../../auth/owner";
import { loginReachable, ownerRouteOpen } from "../../../auth/publicMode";
import { bookSummary, BOOKS, ENTRY_KINDS, listVenues, milestones, VENUE_KINDS } from "../../../economy/economy";
import { getEngine } from "../../../server/engine";
import { brakes, currentCaps } from "../../../economy/ladder";
import { economyBrakeAction, economyEntryAction, economyMilestoneAction, economyReadingAction, economyVenueAction } from "../../actions";

function money(cents: number): string {
  return `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export default async function EconomyDesk({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  const header = await headers();
  if (!loginReachable(header.get("fly-client-ip"), process.env, header.get("x-lumen-desk"))) notFound();
  const jar = await cookies();
  const token = jar.get(OWNER_COOKIE)?.value ?? null;
  const engine = getEngine();
  const authed = engine.authed(`${OWNER_COOKIE}=${encodeURIComponent(token ?? "")}`);
  if (!authed || !ownerRouteOpen("/admin", authed)) redirect("/admin/login");
  const now = Date.now();
  const venues = listVenues(engine.db);
  const ladder = milestones(engine.db);
  const caps = currentCaps(engine.db);
  const tripped = brakes(engine.db);
  return (
    <div className="grid">
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <p className="kicker">Keeper desk</p>
        <h1>Economy</h1>
        <p className="muted">Amounts are US dollars. Do not type account numbers, keys or card numbers here. A name or memo with a long run of digits is refused.</p>
        {query.error ? <p className="muted">Not saved: {String(query.error).slice(0, 40)}</p> : null}
      </section>
      <section className="card">
        <p className="kicker">What she may do now</p>
        <table>
          <tbody>
            <tr><th>Spend without asking</th><td>{caps.selfSpendCents > 0 ? `up to ${money(caps.selfSpendCents)}, and only if the spend settings allow it` : "nothing"}</td></tr>
            <tr><th>Ways to earn at once</th><td>{caps.earningVenues}</td></tr>
            <tr><th>Budget for one venture</th><td>{money(caps.ventureCents)}</td></tr>
            <tr><th>Trading</th><td>{caps.trading}</td></tr>
            <tr><th>Largest live trade</th><td>{money(caps.tradeCents)}</td></tr>
            <tr><th>Trading agents</th><td>{caps.traders}</td></tr>
            <tr><th>Land registry</th><td>{caps.landRegistry ? "open" : "closed"}</td></tr>
            <tr><th>Land sales</th><td>{caps.landSales ? "open" : "closed"}</td></tr>
          </tbody>
        </table>
      </section>
      <section className="card">
        <p className="kicker">Brakes</p>
        {tripped.length === 0 ? <p className="muted">None tripped. A trading venue 20% below its high, or the company book 30% below its high, stops live trading.</p> : null}
        {tripped.map((brake) => (
          <form action={economyBrakeAction} key={brake.scope}>
            <p>{brake.scope}: {money(brake.valueCents)} against a high of {money(brake.peakCents)}. Live trading is stopped.</p>
            <input type="hidden" name="scope" value={brake.scope} />
            <button type="submit">Release this brake</button>
          </form>
        ))}
      </section>
      {BOOKS.map((bookId) => {
        const book = bookSummary(engine.db, bookId, now);
        return (
          <section className="card" key={bookId}>
            <p className="kicker">{bookId} book</p>
            <table>
              <tbody>
                <tr><th>Treasury</th><td>{money(book.treasuryCents)}</td></tr>
                <tr><th>Earned</th><td>{money(book.earnedCents)}</td></tr>
                <tr><th>Income</th><td>{money(book.incomeCents)}</td></tr>
                <tr><th>Expenses</th><td>{money(book.expenseCents)}</td></tr>
                <tr><th>Deposits</th><td>{money(book.depositCents)}</td></tr>
                <tr><th>Withdrawals</th><td>{money(book.withdrawalCents)}</td></tr>
                <tr><th>Reserve</th><td>{money(book.buckets.reserve)}</td></tr>
                <tr><th>Hardware</th><td>{money(book.buckets.hardware)}</td></tr>
                <tr><th>Operations</th><td>{money(book.buckets.operations)}</td></tr>
                <tr><th>Venues not read in 7 days</th><td>{book.staleVenues}</td></tr>
              </tbody>
            </table>
          </section>
        );
      })}
      <section className="card">
        <p className="kicker">Add a venue</p>
        <form action={economyVenueAction}>
          <label>Short id <input name="id" required pattern="[a-z0-9-]{2,40}" placeholder="main-exchange" /></label>
          <label>Name <input name="name" required maxLength={60} /></label>
          <label>Book <select name="bookId">{BOOKS.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Kind <select name="kind">{VENUE_KINDS.map((item) => <option key={item}>{item}</option>)}</select></label>
          <button type="submit">Add venue</button>
        </form>
      </section>
      <section className="card">
        <p className="kicker">Record a balance</p>
        <form action={economyReadingAction}>
          <label>Venue <select name="venueId">{venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.bookId}: {venue.name}</option>)}</select></label>
          <label>Balance in dollars <input name="dollars" required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" /></label>
          <label>Note <input name="note" maxLength={120} /></label>
          <button type="submit">Record balance</button>
        </form>
      </section>
      <section className="card">
        <p className="kicker">Add a line to a book</p>
        <form action={economyEntryAction}>
          <label>Book <select name="bookId">{BOOKS.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Kind <select name="kind">{ENTRY_KINDS.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Dollars <input name="dollars" required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" /></label>
          <label>Category <input name="category" required maxLength={40} /></label>
          <label>Memo <input name="memo" maxLength={160} /></label>
          <label>Paid from <select name="paidFrom"><option>treasury</option><option>outside</option></select></label>
          <label>Bucket, for an expense <select name="bucket"><option>operations</option><option>hardware</option><option>reserve</option></select></label>
          <button type="submit">Add line</button>
        </form>
      </section>
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <p className="kicker">Milestones</p>
        <table>
          <tbody>
            {ladder.map((row) => (
              <tr key={row.thresholdCents}>
                <th>{money(row.thresholdCents)}</th>
                <td>{row.status}</td>
                <td>{row.unlock}</td>
                <td>
                  {row.status === "reached" ? (
                    <form action={economyMilestoneAction}>
                      <input type="hidden" name="threshold" value={row.thresholdCents} />
                      <input name="unlock" maxLength={200} placeholder="Change what this opens, or leave empty" />
                      <button type="submit" name="decision" value="approved">Approve</button>
                      <button type="submit" name="decision" value="declined">Decline</button>
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
