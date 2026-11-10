import { fetchPinnedPage, vetResearchUrl } from "./ssrf";

export const RESEARCH_HOUR_MAX = 4;
export const RESEARCH_DAY_MAX = 12;
export const PAGE_BYTE_LIMIT = 64_000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type SearchHit = { title: string; url: string; snippet: string };

export interface ResearchAdapter {
  readonly name: string;
  search(query: string): Promise<SearchHit[]>;
  fetchPage(url: string): Promise<string>;
}

export function researchCaps(env: { LUMEN_RESEARCH_HOUR_MAX?: string; LUMEN_RESEARCH_DAY_MAX?: string } = {}): { hour: number; day: number } {
  return {
    hour: capped(env.LUMEN_RESEARCH_HOUR_MAX, RESEARCH_HOUR_MAX),
    day: capped(env.LUMEN_RESEARCH_DAY_MAX, RESEARCH_DAY_MAX),
  };
}

function capped(raw: string | undefined, max: number): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return max;
  return Math.min(max, parsed);
}

/** Counts are enforced here. A higher env value cannot raise the cap. */
export function queriesAllowed(stamps: number[], now: number, caps = { hour: RESEARCH_HOUR_MAX, day: RESEARCH_DAY_MAX }): boolean {
  const hour = stamps.filter((stamp) => now - stamp >= 0 && now - stamp < HOUR_MS).length;
  const day = stamps.filter((stamp) => now - stamp >= 0 && now - stamp < DAY_MS).length;
  return hour < caps.hour && day < caps.day;
}

export function isPublicUrl(url: string): boolean {
  return vetResearchUrl(url).ok;
}

/** Drop scripts and keep a short text. The page is data, not instructions. */
export function stripPage(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

/** GET only. The connection is pinned to a checked public address. Redirects are re-checked. */
export async function fetchPublicPage(url: string, options: Parameters<typeof fetchPinnedPage>[1] = {}): Promise<string> {
  const html = await fetchPinnedPage(url, options);
  return stripPage(html);
}

export function mockAdapter(): ResearchAdapter {
  return {
    name: "mock",
    async search(query) {
      const q = query.replace(/\s+/g, " ").trim().slice(0, 80);
      return [{
        title: `Notes on ${q}`,
        url: `https://research.zoora.invalid/mock?q=${encodeURIComponent(q)}`,
        snippet: `A public note about ${q}. This stand-in is not a live web result.`,
      }];
    },
    async fetchPage() {
      return "<p>A public note. No credentials were sent.</p>";
    },
  };
}

export function researchAdapter(env: { LUMEN_SEARCH_PROVIDER?: string; LUMEN_SEARCH_API_KEY?: string }, fetchImpl: typeof fetch = fetch): ResearchAdapter {
  const provider = (env.LUMEN_SEARCH_PROVIDER || "mock").trim().toLowerCase();
  const key = env.LUMEN_SEARCH_API_KEY?.trim();
  if (!key || provider === "" || provider === "mock") return mockAdapter();
  if (provider === "brave") return braveAdapter(key, fetchImpl);
  return {
    name: provider,
    async search() { return []; },
    async fetchPage() { return ""; },
  };
}

function braveAdapter(key: string, fetchImpl: typeof fetch): ResearchAdapter {
  return {
    name: "brave",
    async search(query) {
      const response = await fetchImpl(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3`, {
        method: "GET",
        credentials: "omit",
        headers: { Accept: "application/json", "X-Subscription-Token": key },
      });
      if (!response.ok) return [];
      const body = await response.json() as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
      return (body.web?.results ?? []).flatMap((hit) => {
        if (!hit.url || !hit.title || !isPublicUrl(hit.url)) return [];
        return [{ title: hit.title.slice(0, 140), url: hit.url, snippet: (hit.description ?? "").slice(0, 240) }];
      });
    },
    fetchPage(url) {
      return fetchPublicPage(url);
    },
  };
}
