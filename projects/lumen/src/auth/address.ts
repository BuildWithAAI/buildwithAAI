/**
 * Unset or "none": ignore X-Forwarded-For. The client can put anything there.
 * "fly": use Fly-Client-IP, which Fly sets and the client cannot choose.
 * "forwarded": use the last X-Forwarded-For hop, the one a trusted proxy appends.
 * "cloudflare": use CF-Connecting-IP from Cloudflare Tunnel.
 * "ngrok": use the first X-Forwarded-For hop, which ngrok sets to the visitor.
 */
export function clientAddress(get: (name: string) => string | null, trustedProxy: string | undefined, publicMode = false): string {
  let mode = (trustedProxy ?? "none").trim().toLowerCase();
  if (publicMode && (mode === "none" || mode === "" || mode === "auto")) {
    mode = get("cf-connecting-ip") ? "cloudflare" : "ngrok";
  }
  if (mode === "fly") {
    const ip = get("fly-client-ip")?.trim() ?? "";
    return isIp(ip) ? ip : "unknown";
  }
  if (mode === "cloudflare") {
    const ip = get("cf-connecting-ip")?.trim() ?? "";
    return isIp(ip) ? ip : "unknown";
  }
  if (mode === "ngrok") {
    const first = (get("x-forwarded-for") ?? "").split(",").map((part) => part.trim()).filter(Boolean)[0] ?? "";
    return isIp(first) ? first : "unknown";
  }
  if (mode === "forwarded") {
    const hops = (get("x-forwarded-for") ?? "").split(",").map((part) => part.trim()).filter(Boolean);
    const last = hops[hops.length - 1] ?? "";
    return isIp(last) ? last : "unknown";
  }
  return "direct";
}

function isIp(value: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value) || /^[0-9a-f:]+$/i.test(value);
}
