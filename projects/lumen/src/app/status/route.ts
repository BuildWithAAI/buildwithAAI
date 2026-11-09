import { getEngine } from "../../server/engine";

export const dynamic = "force-dynamic";

export function GET() {
  const snap = getEngine().snapshot();
  return Response.json({
    awake: snap.awake,
    tick: snap.tick,
    placeId: snap.placeId,
    needs: snap.needs,
    mood: snap.mood,
    energy: snap.energy,
    emotions: snap.emotions,
    labels: snap.labels,
    feeling: snap.feeling,
    event: snap.event,
    recentActions: (snap.feed as { kind: string; text: string }[]).slice(0, 8),
  });
}
