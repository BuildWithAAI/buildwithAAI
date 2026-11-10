import net from "node:net";
import tls from "node:tls";

const PAGE_BYTE_LIMIT = 64_000;

export const FETCH_TIMEOUT_MS = 6_000;
export const MAX_REDIRECTS = 3;

const BLOCKED_NAMES = new Set(["localhost", "localhost.localdomain", "metadata", "metadata.google.internal"]);

export type LookupFn = (hostname: string) => Promise<string[]>;
export type Exchange = (request: PinnedRequest) => Promise<PinnedReply>;

export type PinnedRequest = {
  ip: string;
  port: number;
  hostname: string;
  path: string;
  protocol: "http" | "https";
  signal: AbortSignal;
};

export type PinnedReply = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Uint8Array | AsyncIterable<Uint8Array>;
};

export class PageRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export async function defaultLookup(hostname: string): Promise<string[]> {
  const dns = await import("node:dns");
  const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

/** True for private, loopback, link-local, metadata, ULA, CGNAT, and mapped forms of those. */
export function ipBlocked(host: string): boolean {
  const parsed = canonicalIp(host);
  if (!parsed) return false;
  if (parsed.version === 4) return ipv4Blocked(parsed.value);
  return ipv6Blocked(parsed.bytes);
}

export function canonicalIp(host: string): { version: 4; value: number } | { version: 6; bytes: Uint8Array } | null {
  const bare = host.trim().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!bare) return null;
  const v4 = parseIpv4(bare);
  if (v4 != null) return { version: 4, value: v4 };
  const v6 = parseIpv6(bare);
  if (!v6) return null;
  const mapped = mappedIpv4(v6);
  if (mapped != null) return { version: 4, value: mapped };
  return { version: 6, bytes: v6 };
}

export function vetResearchUrl(url: string): { ok: true; protocol: "http" | "https"; hostname: string; port: number; path: string } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "BAD_URL" };
  }
  if (parsed.username || parsed.password) return { ok: false, reason: "CREDENTIALS" };
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, reason: "SCHEME" };
  const protocol = parsed.protocol === "https:" ? "https" : "http";
  const port = parsed.port === "" ? (protocol === "https" ? 443 : 80) : Number(parsed.port);
  if (port !== 80 && port !== 443) return { ok: false, reason: "PORT" };
  if (protocol === "http" && port !== 80) return { ok: false, reason: "PORT" };
  if (protocol === "https" && port !== 443) return { ok: false, reason: "PORT" };
  const hostname = parsed.hostname.replace(/\.$/, "").toLowerCase();
  if (nameBlocked(hostname)) return { ok: false, reason: "NAME" };
  if (canonicalIp(hostname) && ipBlocked(hostname)) return { ok: false, reason: "ADDRESS" };
  return { ok: true, protocol, hostname: parsed.hostname.replace(/\.$/, ""), port, path: `${parsed.pathname}${parsed.search}` || "/" };
}

export async function resolvePublicIp(hostname: string, lookup: LookupFn): Promise<string> {
  if (nameBlocked(hostname)) throw new PageRefused("NAME");
  const literal = canonicalIp(hostname);
  if (literal) {
    if (ipBlocked(hostname)) throw new PageRefused("ADDRESS");
    return literal.version === 4 ? ipv4String(literal.value) : hostname.replace(/^\[|\]$/g, "");
  }
  let addresses: string[] = [];
  try {
    addresses = await lookup(hostname);
  } catch {
    throw new PageRefused("DNS");
  }
  if (!addresses.length) throw new PageRefused("DNS");
  for (const address of addresses) {
    if (!canonicalIp(address) || ipBlocked(address)) throw new PageRefused("ADDRESS");
  }
  const chosen = addresses[0]!;
  const parsed = canonicalIp(chosen);
  if (!parsed || parsed.version !== 4) return chosen.replace(/^\[|\]$/g, "");
  return ipv4String(parsed.value);
}

export async function fetchPinnedPage(url: string, options: { lookup?: LookupFn; exchange?: Exchange; timeoutMs?: number; maxBytes?: number } = {}): Promise<string> {
  const lookup = options.lookup ?? defaultLookup;
  const exchange = options.exchange ?? defaultExchange;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? PAGE_BYTE_LIMIT;
  let current = url;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const vetted = vetResearchUrl(current);
    if (!vetted.ok) throw new PageRefused(vetted.reason);
    const ip = await resolvePublicIp(vetted.hostname, lookup);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let reply: PinnedReply;
    try {
      reply = await exchange({
        ip,
        port: vetted.port,
        hostname: vetted.hostname,
        path: vetted.path,
        protocol: vetted.protocol,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (reply.status >= 300 && reply.status < 400) {
      const location = headerValue(reply.headers, "location");
      if (!location || redirect === MAX_REDIRECTS) throw new PageRefused("REDIRECT");
      current = new URL(location, current).href;
      continue;
    }
    const bytes = await readCapped(reply.body, maxBytes, controller.signal);
    return new TextDecoder().decode(bytes);
  }
  throw new PageRefused("REDIRECT");
}

export async function readCapped(body: Uint8Array | AsyncIterable<Uint8Array>, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body.subarray(0, maxBytes);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    if (signal?.aborted) throw new PageRefused("TIMEOUT");
    const room = maxBytes - total;
    if (room <= 0) break;
    const slice = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
    chunks.push(slice);
    total += slice.byteLength;
    if (total >= maxBytes) break;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function defaultExchange(request: PinnedRequest): Promise<PinnedReply> {
  const socket = request.protocol === "https"
    ? tls.connect({ host: request.ip, port: request.port, servername: request.hostname, rejectUnauthorized: true })
    : net.connect({ host: request.ip, port: request.port });
  const abort = () => socket.destroy();
  if (request.signal.aborted) abort();
  else request.signal.addEventListener("abort", abort, { once: true });
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.once(request.protocol === "https" ? "secureConnect" : "connect", () => {
      socket.off("error", reject);
      resolve();
    });
  });
  const path = request.path.startsWith("/") ? request.path : `/${request.path}`;
  socket.write(`GET ${path} HTTP/1.1\r\nHost: ${request.hostname}\r\nAccept: text/html,text/plain\r\nConnection: close\r\n\r\n`);
  const raw = await readSocket(socket, request.signal);
  const split = raw.indexOf("\r\n\r\n");
  if (split < 0) throw new PageRefused("PAGE");
  const head = new TextDecoder().decode(raw.subarray(0, split));
  const lines = head.split("\r\n");
  const status = Number(lines[0]?.split(" ")[1] ?? 0);
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const mark = line.indexOf(":");
    if (mark > 0) headers[line.slice(0, mark).trim().toLowerCase()] = line.slice(mark + 1).trim();
  }
  return { status, headers, body: raw.subarray(split + 4) };
}

function readSocket(socket: net.Socket, signal: AbortSignal): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const fail = (error: Error) => reject(error);
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("error", fail);
    socket.on("end", () => resolve(Buffer.concat(chunks)));
    signal.addEventListener("abort", () => {
      socket.destroy();
      reject(new PageRefused("TIMEOUT"));
    }, { once: true });
  });
}

function headerValue(headers: PinnedReply["headers"], name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function nameBlocked(hostname: string): boolean {
  const name = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (BLOCKED_NAMES.has(name)) return true;
  if (name.endsWith(".localhost") || name.endsWith(".metadata.google.internal")) return true;
  return false;
}

function ipv4Blocked(value: number): boolean {
  const a = (value >>> 24) & 255;
  const b = (value >>> 16) & 255;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function ipv6Blocked(bytes: Uint8Array): boolean {
  const mapped = mappedIpv4(bytes);
  if (mapped != null) return ipv4Blocked(mapped);
  const first = (bytes[0]! << 8) | bytes[1]!;
  if (bytes.every((byte) => byte === 0)) return true;
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return true;
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((bytes[0]! & 0xff) === 0xff) return true;
  return false;
}

function mappedIpv4(bytes: Uint8Array): number | null {
  const prefix = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (!prefix) return null;
  return ((bytes[12]! << 24) | (bytes[13]! << 16) | (bytes[14]! << 8) | bytes[15]!) >>> 0;
}

function ipv4String(value: number): string {
  return `${(value >>> 24) & 255}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`;
}

function parseIpv4(text: string): number | null {
  if (!/^[\d.xXa-fA-F]+$/.test(text) || text.endsWith(".")) return null;
  const parts = text.split(".");
  if (parts.length === 0 || parts.length > 4) return null;
  const numbers: number[] = [];
  for (const part of parts) {
    const parsed = parseIpPart(part);
    if (parsed == null) return null;
    numbers.push(parsed);
  }
  if (parts.length === 1) return numbers[0]! <= 0xffffffff ? numbers[0]! : null;
  const widths = parts.length === 2 ? [8, 24] : parts.length === 3 ? [8, 8, 16] : [8, 8, 8, 8];
  let value = 0;
  for (let index = 0; index < numbers.length; index += 1) {
    const width = widths[index]!;
    const number = numbers[index]!;
    if (number >= 2 ** width) return null;
    value = (value << width) | number;
  }
  return value >>> 0;
}

function parseIpPart(part: string): number | null {
  if (!part) return null;
  if (/^0x[0-9a-f]+$/i.test(part)) return Number(part);
  if (/^0[0-7]+$/.test(part)) return parseInt(part, 8);
  if (/^\d+$/.test(part)) return Number(part);
  return null;
}

function parseIpv6(text: string): Uint8Array | null {
  if (!text.includes(":")) return null;
  const zone = text.split("%")[0] ?? text;
  const halves = zone.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const parseGroup = (group: string): number[] | null => {
    if (group.includes(".")) {
      const v4 = parseIpv4(group);
      if (v4 == null) return null;
      return [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    }
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    return [parseInt(group, 16)];
  };
  const left: number[] = [];
  const right: number[] = [];
  for (const group of head) {
    const parsed = parseGroup(group);
    if (!parsed) return null;
    left.push(...parsed);
  }
  for (const group of tail) {
    const parsed = parseGroup(group);
    if (!parsed) return null;
    right.push(...parsed);
  }
  const missing = 8 - (left.length + right.length);
  if (halves.length === 1 && missing !== 0) return null;
  if (halves.length === 2 && missing < 0) return null;
  const words = [...left, ...Array(Math.max(0, missing)).fill(0), ...right];
  if (words.length !== 8) return null;
  const bytes = new Uint8Array(16);
  words.forEach((word, index) => {
    bytes[index * 2] = (word >> 8) & 255;
    bytes[index * 2 + 1] = word & 255;
  });
  return bytes;
}
