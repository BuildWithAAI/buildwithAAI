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

export function WishlistView({ items, wants = [] }: { items: WishlistItemView[]; wants?: { id: string; text: string; need: string }[] }) {
  return (
    <div className="card">
      <p className="kicker">Town Center</p>
      <h1>Zoora&apos;s wishes</h1>
      <p className="muted">Things Zoora hopes the keeper will bring, and the wants the bowl is holding. Nothing here takes money.</p>
      <h2>Wants</h2>
      <ul className="feed">
        {wants.length === 0 ? <li>Nothing open. The water is enough for now.</li> : null}
        {wants.map((want) => (
          <li key={want.id}><strong>{want.text}</strong> <span className="muted">({want.need})</span></li>
        ))}
      </ul>
      <h2>Wishlist</h2>
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
