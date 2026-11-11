import { registerVisitor } from "../../../../world/visitors";
import { readVisitorJson, visitorDb, visitorResult } from "../visitorGate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const gate = visitorDb(request);
  if ("closed" in gate) return gate.closed;
  const parsed = await readVisitorJson(request);
  if (!parsed.ok) return parsed.response;
  const result = registerVisitor(gate.db, {
    displayName: parsed.body.displayName,
    ownerContact: parsed.body.ownerContact,
    ip: gate.ip,
    now: Date.now(),
  });
  if (!result.ok) return visitorResult(result.status, { error: result.reason });
  return visitorResult(201, result.visitor);
}
