import { clientAddress } from "../../../auth/owner";
import { getEngine } from "../../../server/engine";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const ip = clientAddress((name) => request.headers.get(name), process.env.LUMEN_TRUSTED_PROXY);
  const result = getEngine().worldRead(ip);
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "no-store" } });
}
