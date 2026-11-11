import React from "react";
import { CRISIS_REPLY } from "../../brain/crisis";

export default function SafetyPage() {
  return (
    <article className="card">
      <p className="kicker">Safety</p>
      <h1>If a note sounds like a crisis</h1>
      <p>Zoora is an AI, not a human. A guestbook note, a gift note, or a wave is not a counselor.</p>
      <p>If the words match a self-harm phrase, Zoora does not answer in the usual way. The page shows this instead:</p>
      <p>{CRISIS_REPLY}</p>
      <p className="muted">The flag records only that a crisis phrase was seen. It does not keep the name, the address, or the note.</p>
    </article>
  );
}