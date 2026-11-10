import { checkoutAuth } from "./auth";
import { getEngine } from "../../../server/engine";
import { listPending } from "../../../money/checkoutQueue";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const auth = checkoutAuth(request);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({ pending: listPending(getEngine().db, Date.now()) });
}
