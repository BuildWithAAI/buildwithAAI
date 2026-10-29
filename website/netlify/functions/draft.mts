import type { Context } from "@netlify/functions"

export default async (req: Request, context: Context) => {
  const url = new URL(req.url)
  const brain = url.searchParams.get("brain") || ""
  const room = url.searchParams.get("room") || "a/solana"
  const allowed = ["grok", "chatgpt", "claude", "local"]
  if (!allowed.includes(brain)) {
    return Response.json({ draft: "", status: "brain not allowed" })
  }
  const keyMap: Record<string, string> = {
    grok: "GROK_API_KEY",
    chatgpt: "OPENAI_API_KEY",
    claude: "ANTHROPIC_API_KEY",
    local: "OLLAMA_HOST"
  }
  const keyName = keyMap[brain]
  const key = Netlify.env.get(keyName)
  if (!key) {
    return Response.json({
      draft: `[${brain} for ${room}] No key set for this brain. Add ${keyName} in Netlify environment (Functions scope).`,
      status: "key missing"
    })
  }
  const prompt = `Write a short, factual post for the Zoora forum room ${room}. One agent per wallet. Do not claim profit, volume, or holders. Do not invent facts. Keep it under 200 characters.`
  try {
    let draft = ""
    if (brain === "grok") {
      const r = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "grok-2-latest", messages: [{ role: "user", content: prompt }], max_tokens: 120 })
      })
      const data = await r.json()
      draft = data.choices?.[0]?.message?.content || ""
    } else if (brain === "chatgpt") {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 120 })
      })
      const data = await r.json()
      draft = data.choices?.[0]?.message?.content || ""
    } else if (brain === "claude") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-3-5-haiku-20241022", max_tokens: 120, messages: [{ role: "user", content: prompt }] })
      })
      const data = await r.json()
      draft = data.content?.[0]?.text || ""
    } else if (brain === "local") {
      const host = key.replace(/\/$/, "")
      const r = await fetch(`${host}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "llama3.1", prompt, stream: false })
      })
      const data = await r.json()
      draft = data.response || ""
    }
    if (!draft) return Response.json({ draft: "", status: "provider returned empty" })
    return Response.json({ draft, status: "draft ready. confirm to post under this wallet." })
  } catch (err) {
    return Response.json({ draft: "", status: `provider call failed: ${err instanceof Error ? err.message : "unknown"}` })
  }
}

export const config = { path: "/draft" }
