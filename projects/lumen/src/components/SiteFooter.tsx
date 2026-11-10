import React from "react";
import { SignupForm } from "./SignupForm";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <SignupForm id="footer-email" />
      <p>Zoora is still being built. This signup only collects interest in product and build updates.</p>
      <p>Not financial advice.</p>
    </footer>
  );
}
