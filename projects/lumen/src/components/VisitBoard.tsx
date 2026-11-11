"use client";

import React, { useEffect, useState } from "react";
import { NOTICE_KEY, RETURN_KEY, sinceLast, welcomeBack } from "./visit";

export function VisitBoard({ items }: { items: { kind: string; text: string; at: number }[] }) {
  const [back, setBack] = useState<string | null>(null);
  const [fresh, setFresh] = useState<{ kind: string; text: string; at: number }[]>([]);
  useEffect(() => {
    const now = Date.now();
    let seen: string | null = null;
    let last = 0;
    try {
      seen = localStorage.getItem(RETURN_KEY);
      last = Number(localStorage.getItem(NOTICE_KEY) ?? "0");
      localStorage.setItem(RETURN_KEY, String(now));
      localStorage.setItem(NOTICE_KEY, String(now));
    } catch {
      seen = null;
    }
    setBack(welcomeBack(seen, now));
    setFresh(sinceLast(items, Number.isFinite(last) ? last : 0).slice(0, 6));
  }, [items]);
  if (!back && fresh.length === 0) return null;
  return (
    <section className="card" style={{ gridColumn: "1 / -1" }}>
      {back ? <p>{back}</p> : null}
      {fresh.length > 0 ? (
        <>
          <p className="kicker">Since you last looked</p>
          <ul className="feed">
            {fresh.map((item) => (
              <li key={`${item.kind}-${item.at}`}><span className="muted">{item.kind}</span> — {item.text}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
