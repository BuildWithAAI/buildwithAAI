import { clientAddress } from "../../../auth/owner";
import { publicModeOn } from "../../../auth/publicMode";
import { allowRate } from "../../../db/db";
import { cachedSnapshot, jsonOrLimited } from "../../../http/publicRead";
import { getEngine } from "../../../server/engine";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const ip = clientAddress((name) => request.headers.get(name), process.env.LUMEN_TRUSTED_PROXY, publicModeOn());
  if (!allowRate(getEngine().db, `health:${ip}`, 30, 60_000, Date.now())) return jsonOrLimited(false, null);
  const snap = cachedSnapshot();
  const body = publicModeOn()
    ? { ok: true, awake: snap.awake }
    : { ok: true, awake: snap.awake, sales: snap.money.sales, spendOpen: snap.money.spendOpen };
  return jsonOrLimited(true, body);
}
