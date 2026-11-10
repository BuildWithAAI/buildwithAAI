import { clientAddress } from "../../../../auth/owner";
import { publicModeOn } from "../../../../auth/publicMode";
import { allowRate } from "../../../../db/db";
import { readLimitedText } from "../../../../http/bodyLimit";
import { acceptTelegramUpdate, TELEGRAM_BODY_MAX } from "../../../../integrations/telegramOwner";
import { getEngine } from "../../../../server/engine";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const limited = await readLimitedText(request, TELEGRAM_BODY_MAX);
  if (!limited.ok) return Response.json({ error: "BODY_TOO_LARGE" }, { status: 413 });
  const engine = getEngine();
  const ip = clientAddress((name) => request.headers.get(name), process.env.LUMEN_TRUSTED_PROXY, publicModeOn());
  if (!allowRate(engine.db, `telegram:${ip}`, 30, 60_000, Date.now())) {
    return Response.json({ error: "RATE_LIMIT" }, { status: 429 });
  }
  const result = acceptTelegramUpdate(
    engine.db,
    process.env,
    limited.text,
    request.headers.get("x-telegram-bot-api-secret-token"),
    (text) => {
      try {
        const turn = engine.ownerChat(text);
        const reply = "reply" in turn && typeof turn.reply === "string" ? turn.reply : undefined;
        return { ok: turn.ok, reply };
      } catch {
        return { ok: false };
      }
    },
  );
  return Response.json({ ok: result.status === 200, reply: result.reply }, { status: result.status });
}
