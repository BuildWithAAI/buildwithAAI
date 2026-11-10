import { WorldStage } from "../../components/WorldStage";
import { getEngine } from "../../server/engine";

export default async function WorldPage({ searchParams }: { searchParams: Promise<{ cam?: string }> }) {
  const params = await searchParams;
  const world = JSON.parse(JSON.stringify(getEngine().world()));
  return (
    <div>
      <p className="kicker">Shared island</p>
      <h1 style={{ marginTop: 0 }}>Zoora's world</h1>
      <p className="muted">A smooth island with a research station. Visitors can watch. An agent moves only with a keeper-issued token. Nothing in this world can spend. Narrow screens drop shadows and use a coarser mesh.</p>
      <WorldStage initial={world} cam={params.cam ?? "overview"} />
    </div>
  );
}
