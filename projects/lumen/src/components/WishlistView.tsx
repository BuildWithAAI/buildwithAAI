import React from "react";

export type WishlistItemView = {
  id: string;
  rank: number;
  name: string;
  why: string;
  estimateCents: number | null;
  linkHref: string | null;
  linkText: string;
};

export function WishlistView({ items }: { items: WishlistItemView[] }) {
  return (
    <div className="card">
      <p className="kicker">Town Center</p>
      <h1>Zoora&apos;s wishlist</h1>
      <p className="muted">Things Zoora hopes the keeper will bring. Nothing here takes money. The keeper brings them from outside the island.</p>
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
    </div>
  );
}
