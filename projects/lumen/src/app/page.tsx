import React from "react";
import { Scene } from "../components/Scene";
import { SignupForm } from "../components/SignupForm";
import { VisitBoard } from "../components/VisitBoard";
import { homeGreeting } from "../components/visit";
import { getEngine } from "../server/engine";

export default function HomePage() {
  const engine = getEngine();
  const snap = engine.snapshot();
  const needs = Object.entries(snap.needs);
  const diary = snap.diary as { text: string; created_at: number }[];
  const gallery = snap.gallery as { title: string; created_at: number }[];
  const builds = engine.db.prepare(
    "SELECT title, kind, created_at FROM world_builds ORDER BY created_at DESC LIMIT 8",
  ).all() as { title: string; kind: string; created_at: number }[];
  const items = [
    ...diary.slice(0, 5).map((row) => ({ kind: "diary", text: row.text, at: row.created_at })),
    ...gallery.slice(0, 5).map((row) => ({ kind: "gallery", text: row.title, at: row.created_at })),
    ...builds.map((row) => ({ kind: row.kind === "garden" ? "garden" : "build", text: row.title, at: row.created_at })),
  ];
  return (
    <div className="grid">
      <section className="card scene-card">
        <Scene
          color={snap.glow.color}
          pulseMs={snap.glow.pulseMs}
          amplitude={snap.glow.amplitude}
          eventKind={snap.event?.kind ?? null}
          asleep={!snap.awake}
          mood={snap.mood}
        />
        <div style={{ padding: "0.9rem 1rem 1.1rem" }}>
          <p className="kicker">Glass Bowl · {snap.placeId.replaceAll("-", " ")}</p>
          <h1 style={{ margin: "0.2rem 0" }}>{homeGreeting(snap.awake, snap.feeling)}</h1>
          {snap.event ? <p className="muted">{snap.event.text}</p> : null}
        </div>
      </section>
      <section className="card">
        <p className="kicker">How the water feels</p>
        <p>{snap.feeling}</p>
        <details>
          <summary>The numbers underneath</summary>
          <p className="muted">Mood {snap.labels.moodLabel} · energy {snap.labels.energyLabel}</p>
          <div className="chips">
            {Object.entries(snap.emotions).map(([name, value]) => (
              <span className="chip" key={name}>{name} {Number(value).toFixed(2)}</span>
            ))}
          </div>
          <div className="bars" style={{ marginTop: "0.8rem" }}>
            {needs.map(([name, value]) => (
              <div className="bar" key={name}>
                <span>{name}</span>
                <div className="track"><div className="fill" style={{ width: `${Math.round(Number(value) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        </details>
      </section>
      <VisitBoard items={items} />
      <section className="card" id="signup" style={{ gridColumn: "1 / -1" }}>
        <h2>Tools for people and AI agents to work together.</h2>
        <p>Zoora is building tools for people and AI agents to work together. Sign up for product and build updates.</p>
        <SignupForm />
      </section>
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <p className="kicker">Live feed</p>
        <ul className="feed">
          {snap.feed.slice(0, 8).map((item, index) => {
            const row = item as { kind: string; text: string; source: string };
            return <li key={index}><span className="muted">{row.kind}</span> — {row.text}</li>;
          })}
        </ul>
      </section>
    </div>
  );
}
