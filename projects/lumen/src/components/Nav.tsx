import React from "react";
import Link from "next/link";

export function Nav({ showKeeper = false, showMoney = false }: { showKeeper?: boolean; showMoney?: boolean }) {
  return (
    <nav className="nav">
      <strong>Zoora</strong>
      <Link href="/world">World</Link>
      <Link href="/gallery">Gallery</Link>
      <Link href="/diary">Diary</Link>
      <Link href="/guestbook">Guestbook</Link>
      <Link href="/world?cam=saloon">Saloon</Link>
      <details className="nav-more">
        <summary>More</summary>
        <Link href="/">Bowl</Link>
        <Link href="/build">Build</Link>
        <Link href="/floor">Floor</Link>
        <Link href="/prints">Prints</Link>
        <Link href="/ideas">Ideas</Link>
        <Link href="/wishlist">Wishes</Link>
        {showMoney ? <Link href="/shop">Shop</Link> : null}
        {showMoney ? <Link href="/books">Books</Link> : null}
        {showKeeper ? <Link href="/admin">Keeper</Link> : null}
      </details>
    </nav>
  );
}
