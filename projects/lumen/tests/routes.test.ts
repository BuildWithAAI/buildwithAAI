import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = new URL("../src/app", import.meta.url);
const ALLOWED = new Set([
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
  "dynamic", "dynamicParams", "revalidate", "fetchCache", "runtime", "preferredRegion", "maxDuration",
  "generateStaticParams", "generateMetadata", "metadata", "viewport", "generateViewport",
  "default",
]);

function files(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...files(path));
    else if (/^(route|page|layout)\.tsx?$/.test(name)) found.push(path);
  }
  return found;
}

function exportedNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|const|class|type|interface|enum)\s+([A-Za-z0-9_]+)/g)) names.push(match[1]!);
  for (const match of source.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of match[1]!.split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.push(name);
    }
  }
  if (/export\s+default\s+/.test(source)) names.push("default");
  return names;
}

describe("app route exports", () => {
  it("keeps route, page, and layout exports to the fields Next allows", () => {
    const bad: string[] = [];
    for (const path of files(APP.pathname)) {
      const names = exportedNames(readFileSync(path, "utf8")).filter((name) => !ALLOWED.has(name));
      if (names.length) bad.push(`${path}: ${names.join(", ")}`);
    }
    expect(bad).toEqual([]);
  });
});
