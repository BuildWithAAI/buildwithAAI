import type { Proof } from "../economy/economy";

function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function day(at: number | null): string {
  return at == null ? "never" : new Date(at).toISOString().slice(0, 10);
}

const WORDS = { ahead: "ahead", reached: "reached, waiting on the keeper", approved: "reached and approved", declined: "reached, not opened" } as const;

/** Public. It is given totals only: no venue names, account ids, memos or notes reach this component. */
export function ProofPanel({ proof }: { proof: Proof }) {
  const reached = proof.milestones.filter((row) => row.status !== "ahead").length;
  return (
    <section className="card" aria-label="Proof">
      <p className="kicker">Proof</p>
      <h2>Earned for Zoora Technologies</h2>
      <p className="money">{money(proof.totalEarnedCents)}</p>
      <p className="muted">
        Everything she has earned: the shop, art, writing, trading and the land. Counted from balances read at each venue, less what the keeper put in and less costs paid from outside. Last reading {day(proof.company.lastReadingAt)}.
        {proof.company.staleVenues > 0 ? ` ${proof.company.staleVenues} venue${proof.company.staleVenues === 1 ? " has" : "s have"} no reading in the last 7 days and ${proof.company.staleVenues === 1 ? "is" : "are"} not counted.` : ""}
      </p>
      <table>
        <tbody>
          <tr><th>Company earned</th><td>{money(proof.company.earnedCents)}</td></tr>
          <tr><th>Land earned</th><td>{money(proof.land.earnedCents)}</td></tr>
          <tr><th>Company treasury</th><td>{money(proof.company.treasuryCents)}</td></tr>
          {proof.company.venues.map((venue) => (
            <tr key={venue.kind}><th>{venue.kind}</th><td>{money(venue.cents)}</td></tr>
          ))}
          <tr><th>Reserve (65%)</th><td>{money(proof.company.buckets.reserve)}</td></tr>
          <tr><th>Hardware (25%)</th><td>{money(proof.company.buckets.hardware)}</td></tr>
          <tr><th>Operations (10%)</th><td>{money(proof.company.buckets.operations)}</td></tr>
        </tbody>
      </table>
      <h2>Milestones</h2>
      <p className="muted">{reached} of {proof.milestones.length} reached. Reaching one opens nothing until the keeper approves it.</p>
      <table>
        <tbody>
          {proof.milestones.map((row) => (
            <tr key={row.thresholdCents}>
              <th>{money(row.thresholdCents)}</th>
              <td>{WORDS[row.status]}{row.reachedAt ? `, ${day(row.reachedAt)}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Land</h2>
      <p className="muted">The island keeps its own books. What it earns counts toward the milestones above.</p>
      <table>
        <tbody>
          <tr><th>Land treasury</th><td>{money(proof.land.treasuryCents)}</td></tr>
          <tr><th>Land income</th><td>{money(proof.land.incomeCents)}</td></tr>
          <tr><th>Land costs</th><td>{money(proof.land.expenseCents)}</td></tr>
        </tbody>
      </table>
    </section>
  );
}
