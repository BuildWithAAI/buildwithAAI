import { cachedSnapshot, jsonOrLimited, publicReadAllowed } from "../../../http/publicRead";
import { publicModeOn } from "../../../auth/publicMode";
import { getEngine } from "../../../server/engine";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  if (!publicReadAllowed(getEngine().db, request)) return jsonOrLimited(false, null);
  const snap = cachedSnapshot();
  const body = publicModeOn()
    ? { ok: true, awake: snap.awake }
    : { ok: true, awake: snap.awake, sales: snap.money.sales, spendOpen: snap.money.spendOpen };
  return jsonOrLimited(true, body);
}
