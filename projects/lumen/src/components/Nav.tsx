import React from "react";
import Link from "next/link";

export function Nav({ showKeeper = false, showMoney = false }: { showKeeper?: boolean; showMoney?: boolean }) {
  return (
    <nav className="nav">
      <strong>Zoora</strong>
      <Link href="/">Bowl</Link>
      <Link href="/world">World</Link>
      <Link href="/build">Build</Link>
      {showMoney ? <Link href="/shop">Shop</Link> : null}
      <Link href="/floor">Floor</Link>
      {showMoney ? <Link href="/books">Books</Link> : null}
      <Link href="/gallery">Gallery</Link>
      <Link href="/prints">Prints</Link>
      <Link href="/diary">Diary</Link>
      <Link href="/guestbook">Guestbook</Link>
      <Link href="/wants">Wants</Link>
      <Link href="/wishlist">Wishlist</Link>
      <Link href="/ideas">Ideas</Link>
      {showKeeper ? <Link href="/admin">Keeper</Link> : null}
    </nav>
  );
}
