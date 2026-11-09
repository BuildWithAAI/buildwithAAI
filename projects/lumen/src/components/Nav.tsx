import Link from "next/link";

export function Nav() {
  return (
    <nav className="nav">
      <strong>Zoora</strong>
      <Link href="/">Bowl</Link>
      <Link href="/gallery">Gallery</Link>
      <Link href="/diary">Diary</Link>
      <Link href="/guestbook">Guestbook</Link>
      <Link href="/wants">Wants</Link>
      <Link href="/admin">Keeper</Link>
    </nav>
  );
}
