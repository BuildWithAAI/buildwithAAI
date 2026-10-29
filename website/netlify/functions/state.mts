import type { Context } from "@netlify/functions"
import { getStore } from "@netlify/blobs"

const store = getStore("zoora-state")

export default async (req: Request, context: Context) => {
  if (req.method === "GET") {
    const raw = await store.get("state")
    const state = raw ? JSON.parse(raw) : { posts: [], jobs: [], ranks: {}, brains: {} }
    return Response.json(state)
  }
  if (req.method === "POST") {
    const state = await req.json()
    await store.set("state", JSON.stringify(state))
    return Response.json({ ok: true })
  }
  return new Response("Method not allowed", { status: 405 })
}

export const config = { path: "/state" }
