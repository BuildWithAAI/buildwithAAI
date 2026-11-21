import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { OWNER_COOKIE } from "../../../auth/owner";
import { loginReachable, ownerRouteOpen } from "../../../auth/publicMode";
import { flag } from "../../../db/db";
import { IDEA_KINDS } from "../../../forge/ideas";
import { LIMITS } from "../../../forge/recipe";
import { FORGE, RECIPE_GUIDE, standing } from "../../../forge/store";
import { getEngine } from "../../../server/engine";
import { forgeIdeaAction, forgeModelAction, forgeRecipeAction, forgeRemoveAction, forgeUndoAction } from "../../actions";

export default async function ForgeDesk({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  const header = await headers();
  if (!loginReachable(header.get("fly-client-ip"), process.env, header.get("x-lumen-desk"))) notFound();
  const jar = await cookies();
  const token = jar.get(OWNER_COOKIE)?.value ?? null;
  const engine = getEngine();
  const authed = engine.authed(`${OWNER_COOKIE}=${encodeURIComponent(token ?? "")}`);
  if (!authed || !ownerRouteOpen("/admin", authed)) redirect("/admin/login");
  const builds = standing(engine.db).reverse();
  const model = flag(engine.db, "forge_model", "1") === "1";
  return (
    <div className="grid">
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <p className="kicker">Keeper desk</p>
        <h1>The forge</h1>
        <p className="muted">Her modelling engine. She raises at most {FORGE.perDay} builds a day, one every {FORGE.everyMs / 3_600_000} hours, up to {FORGE.standing} standing. One build may be {LIMITS.triangles.toLocaleString("en-US")} triangles, {LIMITS.radius} metres from its centre and {LIMITS.height} metres tall. The world's creative switch on the keeper page stops her building.</p>
        {query.error ? <p className="muted">Not done: {String(query.error).slice(0, 40)}</p> : null}
        <form action={forgeModelAction}>
          <p>{model ? "When a model is connected, she designs her own builds with it." : "She builds only from the ideas she already knows."}</p>
          <button type="submit" name="on" value={model ? "0" : "1"}>{model ? "Use her known ideas only" : "Let her design with her model"}</button>
        </form>
      </section>
      {builds.map((build) => (
        <section className="card" key={build.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/forge/${build.id}/picture?v=${build.version}`} alt={build.name} style={{ width: "100%", height: "auto", borderRadius: "12px" }} />
          <h2>{build.name}</h2>
          <p className="muted">{build.kind} · by {build.by} · version {build.version} · {build.triangles.toLocaleString("en-US")} triangles · site {build.site}</p>
          <form action={forgeUndoAction}>
            <input type="hidden" name="id" value={build.id} />
            <button type="submit">{build.version > 1 ? "Undo the last change" : "Take it down"}</button>
          </form>
          {build.version > 1 ? (
            <form action={forgeRemoveAction}>
              <input type="hidden" name="id" value={build.id} />
              <button type="submit">Take it down</button>
            </form>
          ) : null}
        </section>
      ))}
      <section className="card">
        <p className="kicker">Raise one of her known ideas</p>
        <form action={forgeIdeaAction}>
          <label>Idea <select name="kind">{IDEA_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
          <button type="submit">Raise it</button>
        </form>
      </section>
      <section className="card" style={{ gridColumn: "1 / -1" }}>
        <p className="kicker">Raise or change a build from a recipe</p>
        <form action={forgeRecipeAction}>
          <label>Change this build, or leave empty to raise a new one <select name="id"><option value="">A new build</option>{builds.map((build) => <option key={build.id} value={build.id}>{build.name}</option>)}</select></label>
          <label>Recipe, as JSON <textarea name="recipe" rows={10} required maxLength={60000} spellCheck={false} /></label>
          <button type="submit">Build it</button>
        </form>
        <pre style={{ whiteSpace: "pre-wrap" }} className="muted">{RECIPE_GUIDE}</pre>
      </section>
    </div>
  );
}
