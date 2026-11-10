import React from "react";
import { Nav } from "./Nav";
import { SignupForm } from "./SignupForm";
import type { WishlistItemView } from "./WishlistView";
import type { PublicBooks } from "../money/publicBooks";

function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function LedgerPanel({ books }: { books: PublicBooks }) {
  return (
    <section className="card world-panel" data-ledger-panel="1">
      <p className="kicker">Ledger</p>
      <p>{books.headline}</p>
      {books.empty ? null : (
        <>
          <p>Income {formatCents(books.incomeCents ?? 0)}. Spending {formatCents(books.spendingCents ?? 0)}. Balance {formatCents(books.balanceCents ?? 0)}.</p>
          <ul className="feed">
            {books.lines.map((line, index) => (
              <li key={`${line.kind}-${index}`}>{line.kind} {formatCents(line.cents)}</li>
            ))}
          </ul>
        </>
      )}
      {books.simulated.length ? (
        <div data-simulated="1">
          <p className="kicker">PAPER / SIMULATED</p>
          <p>{books.liveMoney ? "Paper and Saloon results stay here. They are not the ledger balance." : "Live money is off. Paper and Saloon results stay here. They are not the ledger balance."}</p>
          <ul className="feed">
            {books.simulated.map((row) => <li key={row.label}>{row.label}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function WishPanel({ items }: { items: WishlistItemView[] }) {
  return (
    <section className="card world-panel" data-wish-panel="1">
      <p className="kicker">Wishlist</p>
      <p className="muted">Read only. Nothing here takes money.</p>
      {items.length === 0 ? <p>The board is blank.</p> : null}
      <ol className="feed">
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.rank}. {item.name}</strong>
            <div>{item.why}</div>
            <div className="muted">{item.estimateCents == null ? "No estimate." : `About $${(item.estimateCents / 100).toFixed(2)}, a guess.`}</div>
            {item.linkText ? <div>{item.linkHref ? <a href={item.linkHref}>{item.linkText}</a> : item.linkText}</div> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function HomeDrawer({
  greeting,
  showKeeper,
  showMoney,
}: {
  greeting: string;
  showKeeper: boolean;
  showMoney: boolean;
}) {
  return (
    <details className="home-drawer card">
      <summary data-greeting="1">{greeting}</summary>
      <div data-home-notices="1">
        <p>Zoora is an AI, not a human.</p>
        <p>Not financial advice.</p>
        <SignupForm id="home-email" />
        <Nav compact showKeeper={showKeeper} showMoney={showMoney} />
      </div>
    </details>
  );
}
