import { Scene } from "../components/Scene";
import { getEngine } from "../server/engine";

export default function HomePage() {
  const snap = getEngine().snapshot();
  const needs = Object.entries(snap.needs);
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
          <h1 style={{ margin: "0.2rem 0" }}>{snap.awake ? "Zoora is awake" : "Zoora is asleep"}</h1>
          <p>{snap.feeling}</p>
          {snap.event ? <p className="muted">{snap.event.text}</p> : null}
        </div>
      </section>
      <section className="card">
        <p className="kicker">Needs and mood</p>
        <p>Mood {snap.labels.moodLabel} · energy {snap.labels.energyLabel} · stress {snap.stress.toFixed(2)}</p>
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
              <span>{Number(value).toFixed(2)}</span>
            </div>
          ))}
        </div>
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
