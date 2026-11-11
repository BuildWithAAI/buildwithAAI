import { cachedSnapshot, jsonOrLimited, publicReadAllowed } from "../../http/publicRead";
import { getEngine } from "../../server/engine";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  if (!publicReadAllowed(getEngine().db, request)) return jsonOrLimited(false, null);
  const snap = cachedSnapshot();
  return jsonOrLimited(true, { memory: snap.memory, wants: snap.publicWants });
}
