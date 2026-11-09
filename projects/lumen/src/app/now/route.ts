import { getEngine } from "../../server/engine";

export const dynamic = "force-dynamic";

export function GET() {
  const snap = getEngine().snapshot();
  return Response.json({
    protocol: snap.protocol,
    awake: snap.awake,
    doing: snap.placeId,
    thought: snap.feeling,
    feeling: snap.labels,
    needs: snap.needs,
    event: snap.event?.text ?? null,
    glow: snap.glow,
  });
}
