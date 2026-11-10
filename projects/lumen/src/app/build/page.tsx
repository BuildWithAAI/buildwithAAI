import { BuildView } from "../../components/BuildView";
import { loadBuildLog } from "../../build/log";
import { getEngine } from "../../server/engine";

export default function BuildPage() {
  const entries = loadBuildLog();
  const snap = getEngine().snapshot();
  const world = getEngine().world();
  const zoora = world.agents.find((agent) => agent.name === "Zoora");
  return (
    <BuildView
      entries={entries}
      place={zoora?.placeId ?? snap.placeId}
      feeling={zoora?.feeling || snap.feeling}
      activity={zoora?.activity || "awake"}
    />
  );
}
