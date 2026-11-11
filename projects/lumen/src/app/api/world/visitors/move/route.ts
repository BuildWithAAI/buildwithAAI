import { moveVisitor } from "../../../../../world/visitors";
import { bearerToken, readVisitorJson, visitorDb, visitorResult } from "../../visitorGate";

export const dynamic = "force-dynamic";

function whole(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export async function POST(request: Request) {
  const gate = visitorDb(request);
  if ("closed" in gate) return gate.closed;
  const parsed = await readVisitorJson(request);
  if (!parsed.ok) return parsed.response;
  const cx = whole(parsed.body.cx);
  const cy = whole(parsed.body.cy);
  const tx = whole(parsed.body.tx);
  const ty = whole(parsed.body.ty);
  if (cx == null || cy == null || tx == null || ty == null) return visitorResult(400, { error: "POSITION" });
  const result = moveVisitor(gate.db, bearerToken(request), { cx, cy, tx, ty }, gate.ip, Date.now());
  if (!result.ok) return visitorResult(result.status, { error: result.reason });
  return visitorResult(200, { agent: result.guest });
}
