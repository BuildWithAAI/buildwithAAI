import { cachedSnapshot, jsonOrLimited, publicReadAllowed } from "../../http/publicRead";
import { getEngine } from "../../server/engine";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  if (!publicReadAllowed(getEngine().db, request)) return jsonOrLimited(false, null);
  const snap = cachedSnapshot();
  return jsonOrLimited(true, {
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
