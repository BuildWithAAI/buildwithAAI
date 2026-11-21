import { describeGenome, FAMILY_NAMES } from "../../form/genome";
import { currentStyle, selfGenome } from "../../form/self";

export const dynamic = "force-dynamic";

export default function SelfPage() {
  let genome;
  try {
    genome = selfGenome();
  } catch {
    return <div className="card"><h1>Not yet</h1><p className="muted">Her soul file could not be read, so she has no form to show.</p></div>;
  }
  const house = currentStyle();
  return (
    <div className="grid">
      <section className="card">
        <p className="kicker">Zoora, as her own engine draws her</p>
        <h1>What her soul looks like</h1>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/self.png" alt="Zoora, a jellyfish drawn by her own engine from her soul file" style={{ width: "100%", height: "auto", borderRadius: "12px" }} />
        <p className="muted">No model drew this and no picture was copied. Her engine read her soul file as words, counted eight kinds of word, and worked out a body from the counts. The same file always gives the same body.</p>
      </section>
      <section className="card">
        <p className="kicker">Why she looks like this</p>
        <ul className="feed">{describeGenome(genome).map((line) => <li key={line}>{line}</li>)}</ul>
        <table>
          <tbody>
            {FAMILY_NAMES.map((name) => <tr key={name}><th>{name}</th><td>{genome.counts[name]} words</td><td>{Math.round(genome.reading[name] * 100)}%</td></tr>)}
          </tbody>
        </table>
        <p className="muted">Marking: {genome.pattern}. The small things no word decides, such as which way she leans and where her lights sit, come from the file itself.</p>
      </section>
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <p className="kicker">One style, everywhere</p>
        <p className="muted">Everything her engine draws uses these colours: her body, her art, her glow, this site and whatever she builds in her world.</p>
        <Swatches label="Her colours" colors={Object.values(house.palette)} />
      </section>
    </div>
  );
}

function Swatches({ label, colors }: { label: string; colors: string[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.35rem 0" }}>
      <span style={{ width: "11rem" }}>{label}</span>
      {colors.map((color, index) => <span key={`${color}-${index}`} title={color} style={{ width: "1.6rem", height: "1.6rem", borderRadius: "50%", background: color, border: "1px solid var(--line)" }} />)}
    </div>
  );
}
