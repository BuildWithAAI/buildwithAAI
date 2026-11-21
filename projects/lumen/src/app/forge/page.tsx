import { standing } from "../../forge/store";
import { getEngine } from "../../server/engine";

export const dynamic = "force-dynamic";

export default function ForgePage() {
  const builds = standing(getEngine().db).reverse();
  return (
    <div>
      <p className="kicker">What Zoora has built</p>
      <h1>Her world, past the shore</h1>
      <p className="muted">Her island is her home. Everything here she raised herself with her own modelling engine, each on its own floating islet. She decides what to build. Her engine gives all of it the same hand, so it is one world.</p>
      {builds.length === 0 ? <p>Nothing stands yet.</p> : null}
      <div className="grid">
        {builds.map((build) => (
          <article className="card" key={build.id}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/forge/${build.id}/picture?v=${build.version}`} alt={`${build.name}, built by Zoora`} style={{ width: "100%", height: "auto", borderRadius: "12px" }} />
            <h2>{build.name}</h2>
            <p className="muted">{build.by === "zoora" ? "She raised it." : "Raised with her keeper."} Version {build.version}. {Math.round(build.height)} metres tall.</p>
          </article>
        ))}
      </div>
    </div>
  );
}
