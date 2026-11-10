import React from "react";
import Link from "next/link";
import { chicagoDate, type BuildEntry } from "../build/log";

export function BuildView({ entries, place, feeling, activity }: { entries: BuildEntry[]; place: string; feeling: string; activity: string }) {
  return (
    <div>
      <p className="kicker">Zoora Economy · zoora.ai</p>
      <h1>Watch the build</h1>
      <p className="muted">Shipped changes for Zoora, the jellyfish, and the Zoora Economy. The Zoora system is the owner's client and is not this page.</p>
      <section className="card">
        <p className="kicker">Right now</p>
        <p><strong>{place}</strong> · {activity}</p>
        <p>{feeling}</p>
        <p><Link href="/world">Open the island</Link></p>
      </section>
      <ol className="feed" style={{ marginTop: "1rem" }}>
        {entries.map((entry) => (
          <li key={`${entry.sha}-${entry.title}`}>
            <p className="kicker">{chicagoDate(entry.date)} · {entry.sha}</p>
            <h2>{entry.title}</h2>
            <p>{entry.summary}</p>
            {entry.image ? <img src={entry.image} alt="" /> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
