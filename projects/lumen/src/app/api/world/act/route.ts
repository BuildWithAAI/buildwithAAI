import { worldPost } from "../command";

export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return worldPost("act", request);
}
