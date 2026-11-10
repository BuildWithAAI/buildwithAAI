import { getEngine } from "../../../server/engine";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(getEngine().world(), { headers: { "cache-control": "no-store" } });
}
