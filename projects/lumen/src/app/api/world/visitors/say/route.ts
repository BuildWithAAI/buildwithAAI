import { sayVisitor } from "../../../../../world/visitors";
import { bearerToken, readVisitorJson, refuseVisitorPost, visitorDb, visitorResult } from "../../visitorGate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const refused = refuseVisitorPost(request);
  if (refused) return refused;
  const gate = visitorDb(request);
  if ("closed" in gate) return gate.closed;
  const parsed = await readVisitorJson(request);
  if (!parsed.ok) return parsed.response;
  const result = sayVisitor(gate.db, bearerToken(request), parsed.body.text, gate.ip, Date.now());
  if (!result.ok) return visitorResult(result.status, { error: result.reason });
  return visitorResult(200, { agent: result.guest });
}
