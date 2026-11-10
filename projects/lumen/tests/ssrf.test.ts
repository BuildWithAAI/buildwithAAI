import { describe, expect, it } from "vitest";
import { fetchPublicPage } from "../src/research/search";
import { ipBlocked, PageRefused, vetResearchUrl, type PinnedReply } from "../src/research/ssrf";

const publicLookup = async () => ["93.184.216.34"];

function reply(status: number, headers: Record<string, string>, body = "ok"): PinnedReply {
  return { status, headers, body: new TextEncoder().encode(body) };
}

describe("research fetch address checks", () => {
  it("blocks private, loopback, link-local, metadata, ULA, CGNAT, and disguised addresses", () => {
    const blocked = [
      "http://127.0.0.1/",
      "http://127.1/",
      "http://0x7f000001/",
      "http://2130706433/",
      "http://0177.0.0.1/",
      "http://0x7f.0.0.1/",
      "http://0x7f.0x0.0x0.0x1/",
      "http://10.1.2.3/",
      "http://192.168.0.5/",
      "http://172.16.0.1/",
      "http://169.254.169.254/",
      "http://100.64.0.1/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:7f00:1]/",
      "http://[fd00::1]/",
      "http://[fc00::1]/",
      "http://[fe80::1]/",
      "http://localhost/",
      "http://metadata.google.internal/",
      "http://example.com:8080/",
      "https://example.com:80/",
      "ftp://example.com/",
      "http://user:pass@example.com/",
    ];
    for (const url of blocked) expect(vetResearchUrl(url).ok, url).toBe(false);
    expect(ipBlocked("127.0.0.1")).toBe(true);
    expect(ipBlocked("93.184.216.34")).toBe(false);
    expect(vetResearchUrl("https://example.com/path").ok).toBe(true);
    expect(vetResearchUrl("http://example.com/").ok).toBe(true);
  });

  it("pins the connection to the checked address and re-checks a redirect to localhost", async () => {
    const pinned: string[] = [];
    await expect(fetchPublicPage("http://example.com/start", {
      lookup: publicLookup,
      exchange: async (request) => {
        pinned.push(request.ip);
        return reply(302, { location: "http://127.0.0.1/secret" });
      },
    })).rejects.toBeInstanceOf(PageRefused);
    expect(pinned).toEqual(["93.184.216.34"]);
  });

  it("stops after three redirects", async () => {
    let hops = 0;
    await expect(fetchPublicPage("https://example.com/a", {
      lookup: publicLookup,
      exchange: async () => {
        hops += 1;
        return reply(302, { location: `https://example.com/${hops}` });
      },
    })).rejects.toMatchObject({ reason: "REDIRECT" });
    expect(hops).toBe(4);
  });
});
