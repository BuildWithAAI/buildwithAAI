import { displayFinding } from "../../research/ideas";
import { getEngine } from "../../server/engine";

export default function IdeasPage() {
  const board = getEngine().snapshot().ideas;
  return (
    <div>
      <p className="kicker">Idea notebook</p>
      <h1>What Zoora is researching</h1>
      <p className="muted">Ideas come from needs, wants, sales, and visitor notes. A finding always names its source. A brief is a proposal for the keeper. Nothing on this page can spend.</p>
      {board.length === 0 ? <p>The notebook is empty. Zoora has not sat down with a question yet.</p> : null}
      {board.map(({ idea, findings, brief }) => (
        <article className="card" key={idea.id} style={{ marginTop: "1rem" }}>
          <p className="kicker">{idea.kind} · {idea.status}</p>
          <h2>{idea.title}</h2>
          <p>{idea.why}</p>
          {findings.length ? (
            <ul className="feed">
              {findings.map((finding) => {
                const shown = displayFinding(finding);
                return (
                  <li key={finding.id}>
                    <strong>{shown.label}</strong>
                    <p>{shown.text}</p>
                    <p className="muted"><a href={finding.sourceUrl}>{finding.sourceUrl}</a></p>
                  </li>
                );
              })}
            </ul>
          ) : <p className="muted">No sourced findings yet.</p>}
          {brief ? (
            <div>
              <h3>Brief</h3>
              <p><strong>Problem.</strong> {brief.problem}</p>
              <p><strong>Who would pay.</strong> {brief.whoPays}</p>
              <p><strong>Rough costs.</strong> {brief.costs}</p>
              <p><strong>Risks.</strong> {brief.risks}</p>
              <p><strong>First test.</strong> {brief.firstTest}</p>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
