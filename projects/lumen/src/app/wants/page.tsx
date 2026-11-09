import { getEngine } from "../../server/engine";

export default function WantsPage() {
  const wants = getEngine().snapshot().publicWants;
  return (
    <div className="card">
      <p className="kicker">Public wants</p>
      <h1>What Zoora wants</h1>
      <p className="muted">This list is wants only. It has no prices, merchants, or card details.</p>
      <ul className="feed">
        {wants.length === 0 ? <li>Nothing open. The water is enough for now.</li> : null}
        {wants.map((want) => (
          <li key={want.id}><strong>{want.text}</strong> <span className="muted">({want.need})</span></li>
        ))}
      </ul>
    </div>
  );
}
