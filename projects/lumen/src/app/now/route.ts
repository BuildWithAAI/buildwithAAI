import { cachedSnapshot, jsonOrLimited, publicReadAllowed } from "../../http/publicRead";
import { getEngine } from "../../server/engine";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  if (!publicReadAllowed(getEngine().db, request)) return jsonOrLimited(false, null);
  const snap = cachedSnapshot();
  return jsonOrLimited(true, {
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
