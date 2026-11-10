import Link from "next/link";

export function Nav({ showKeeper = false }: { showKeeper?: boolean }) {
  return (
    <nav className="nav">
      <strong>Zoora</strong>
      <Link href="/">Bowl</Link>
      <Link href="/world">World</Link>
      <Link href="/build">Build</Link>
      <Link href="/shop">Shop</Link>
      <Link href="/floor">Floor</Link>
      <Link href="/books">Books</Link>
      <Link href="/gallery">Gallery</Link>
      <Link href="/prints">Prints</Link>
      <Link href="/diary">Diary</Link>
      <Link href="/guestbook">Guestbook</Link>
      <Link href="/wants">Wants</Link>
      <Link href="/ideas">Ideas</Link>
      {showKeeper ? <Link href="/admin">Keeper</Link> : null}
    </nav>
  );
}
