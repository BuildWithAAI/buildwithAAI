/**
 * Paths a proposal may never change. A proposal is text Zoora wrote, and some of what she reads comes from
 * outside, so a proposal is handled as data. Whatever builds it may not touch her soul, her money rails,
 * the owner's login, the security code, the build and deploy files, or the tests that hold those in place.
 * A change to any of these is the owner's own change, made by the owner.
 */
export const PROTECTED: readonly RegExp[] = [
  /^zoora\//,
  /^src\/money\//,
  /^src\/auth\//,
  /^src\/economy\//,
  /^src\/fulfillment\//,
  /^src\/security\//,
  /^src\/trading\//,
  /^src\/integrations\//,
  /^src\/middleware\.ts$/,
  /^src\/http\//,
  /^src\/identity\//,
  /^src\/db\//,
  /^src\/app\/actions\.ts$/,
  /^src\/app\/admin\//,
  /^src\/app\/api\//,
  /^tests\//,
  /^scripts\//,
  /^\.github\//,
  /^(Dockerfile|docker-entrypoint\.sh|desk-proxy\.mjs|fly\.toml|next\.config\.ts|package\.json|package-lock\.json|tsconfig\.json|\.env.*|\.npmrc)$/,
];

/** Normalised first, so `./src/../zoora/SOUL.md` and a backslash path are judged as what they reach. */
export function normalise(file: string): string | null {
  const parts: string[] = [];
  for (const part of file.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.length ? parts.join("/") : null;
}

export function protectedPath(file: string): boolean {
  const clean = normalise(file);
  // A path that climbs out of the project, or is empty, is treated as protected.
  if (clean == null) return true;
  return PROTECTED.some((pattern) => pattern.test(clean));
}

/** The files a proposal's change may not include. Empty means the change stays inside what a proposal may touch. */
export function blockedFiles(files: string[]): string[] {
  return files.filter(protectedPath);
}
