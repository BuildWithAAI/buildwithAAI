import React from "react";
import Link from "next/link";

export default function SuccessPage() {
  return (
    <div className="card">
      <p className="kicker">Zoora</p>
      <h1>Almost done</h1>
      <p>Check your inbox for a confirmation email from Zoora and click the link to finish signing up.</p>
      <p className="muted">You can unsubscribe from any email at any time.</p>
      <p><Link href="/">Return to Zoora</Link></p>
    </div>
  );
}
