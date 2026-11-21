import { SELF_PICTURES, selfPng, type SelfPicture } from "../../../form/self";

export const dynamic = "force-dynamic";

/** Her own pictures, drawn by her engine. Only the fixed names are served. */
export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  if (!Object.prototype.hasOwnProperty.call(SELF_PICTURES, name)) return new Response("Not found", { status: 404 });
  let png: Buffer;
  try {
    png = selfPng(name as SelfPicture);
  } catch {
    return new Response("Not ready", { status: 503 });
  }
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
