import { headers } from "next/headers";
import { displayFinding, publicBriefLine, publicSourceHref, publicSourceLabel, publicVisitorWhy } from "../../research/ideas";
import { getEngine } from "../../server/engine";

export default async function IdeasPage() {
  const host = (await headers()).get("host");
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
          <p>{publicVisitorWhy(idea, host)}</p>
          {findings.length ? (
            <ul className="feed">
              {findings.map((finding) => {
                const shown = displayFinding(finding);
                const source = publicSourceLabel(finding.sourceUrl);
                const href = publicSourceHref(finding.sourceUrl);
                return (
                  <li key={finding.id}>
                    <strong>{shown.label}</strong>
                    <p>{shown.text}</p>
                    {source && href ? <p className="muted"><a href={href}>{source}</a></p> : null}
                  </li>
                );
              })}
            </ul>
          ) : <p className="muted">No sourced findings yet.</p>}
          {brief ? (
            <div>
              <h3>Brief</h3>
              <p><strong>Problem.</strong> {publicBriefLine(brief.problem)}</p>
              <p><strong>Who would pay.</strong> {publicBriefLine(brief.whoPays)}</p>
              <p><strong>Rough costs.</strong> {publicBriefLine(brief.costs)}</p>
              <p><strong>Risks.</strong> {publicBriefLine(brief.risks)}</p>
              <p><strong>First test.</strong> {publicBriefLine(brief.firstTest)}</p>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
