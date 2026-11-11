import { describe, expect, it } from "vitest";
import { readLimitedText, WEBHOOK_MAX_BYTES, WORLD_MAX_BYTES } from "../src/http/bodyLimit";

function stream(chunks: Uint8Array[], pulled: { n: number }): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      pulled.n += 1;
      const next = chunks[index];
      index += 1;
      if (!next) controller.close();
      else controller.enqueue(next);
    },
  });
}

describe("request body caps", () => {
  it("rejects a declared webhook body over 256KB before draining it", async () => {
    const pulled = { n: 0 };
    const chunks = Array.from({ length: 40 }, () => new Uint8Array(1000));
    const request = new Request("http://app/api/stripe/webhook", {
      method: "POST",
      headers: { "content-length": String(WEBHOOK_MAX_BYTES + 1) },
      body: stream(chunks, pulled),
      duplex: "half",
    });
    const result = await readLimitedText(request, WEBHOOK_MAX_BYTES);
    expect(result).toEqual({ ok: false, status: 413 });
    expect(pulled.n).toBeLessThan(chunks.length);
  });

  it("stops a world body at 8KB while the rest is still unread", async () => {
    const pulled = { n: 0 };
    const chunks = Array.from({ length: 20 }, () => new Uint8Array(1000));
    const request = new Request("http://app/api/world/act", {
      method: "POST",
      body: stream(chunks, pulled),
      duplex: "half",
    });
    const result = await readLimitedText(request, WORLD_MAX_BYTES);
    expect(result).toEqual({ ok: false, status: 413 });
    expect(pulled.n).toBeLessThan(chunks.length);
  });

  it("keeps a small world body", async () => {
    const request = new Request("http://app/api/world/move", {
      method: "POST",
      body: JSON.stringify({ placeId: "town-center" }),
    });
    const result = await readLimitedText(request, WORLD_MAX_BYTES);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toContain("town-center");
  });
});
