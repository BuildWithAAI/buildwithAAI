import React from "react";
import Link from "next/link";
import { SignupForm } from "./SignupForm";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <SignupForm id="footer-email" />
      <p className="row">
        <Link href="/build">Build</Link>
        <Link href="/prints">Prints</Link>
        <Link href="/ideas">Ideas</Link>
        <Link href="/floor">Floor</Link>
        <Link href="/wishlist">Wishes</Link>
        <Link href="/safety">Safety</Link>
      </p>
      <p>Zoora is still being built. This signup only collects interest in product and build updates.</p>
      <p>Zoora is an AI, not a human.</p>
      <p>Not financial advice.</p>
    </footer>
  );
}
