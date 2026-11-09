import { getEngine } from "../../server/engine";

export const dynamic = "force-dynamic";

export function GET() {
  const snap = getEngine().snapshot();
  return Response.json({ feed: snap.feed });
}
