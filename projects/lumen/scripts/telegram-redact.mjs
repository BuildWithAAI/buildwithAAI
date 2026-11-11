export function redactToken(text, token) {
  let out = String(text ?? "");
  if (token && token.length >= 8) out = out.split(token).join("[redacted]");
  return out.replace(/https?:\/\/api\.telegram\.org\/bot[^/\s"'<>]+/gi, "https://api.telegram.org/bot[redacted]");
}
