import { cachedSnapshot, jsonOrLimited, publicReadAllowed } from "../../http/publicRead";
import { getEngine } from "../../server/engine";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const allowed = publicReadAllowed(getEngine().db, request);
  if (!allowed) return jsonOrLimited(false, null);
  const snap = cachedSnapshot();
  return jsonOrLimited(true, { feed: snap.feed });
}
