import { getEngine } from "../../server/engine";

export default function DiaryPage() {
  const snap = getEngine().snapshot();
  const rows = snap.diary as { text: string; tone: string; created_at: number }[];
  return (
    <div className="card">
      <p className="kicker">Diary</p>
      <h1>What Zoora wrote</h1>
      <ul className="feed">
        {rows.map((row, index) => (
          <li key={index}>
            <span className="muted">{row.tone}</span> — {row.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
