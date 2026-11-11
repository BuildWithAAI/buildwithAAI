import { revokeVisitorToken } from "../../../../../world/visitors";
import { bearerToken, refuseVisitorPost, visitorDb, visitorResult } from "../../visitorGate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const refused = refuseVisitorPost(request);
  if (refused) return refused;
  const gate = visitorDb(request);
  if ("closed" in gate) return gate.closed;
  const result = revokeVisitorToken(gate.db, bearerToken(request), Date.now());
  if (!result.ok) return visitorResult(401, { error: result.reason });
  return visitorResult(200, { ok: true });
}
