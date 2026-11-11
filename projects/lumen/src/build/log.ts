import { readFileSync } from "node:fs";
import path from "node:path";

export type BuildEntry = {
  sha: string;
  title: string;
  summary: string;
  date: string;
  image: string;
};

export function parseBuildLog(markdown: string): BuildEntry[] {
  const blocks = markdown.split(/^---\s*$/m).map((block) => block.trim()).filter((block) => block.startsWith("sha:"));
  return blocks.map((block) => {
    const fields = Object.fromEntries(block.split("\n").map((line) => {
      const mark = line.indexOf(":");
      if (mark < 0) return ["", ""];
      return [line.slice(0, mark).trim(), line.slice(mark + 1).trim()];
    }));
    return {
      sha: fields.sha ?? "",
      title: fields.title ?? "",
      summary: fields.summary ?? "",
      date: fields.date ?? "",
      image: fields.image ?? "",
    };
  }).filter((entry) => entry.sha && entry.title);
}

export function loadBuildLog(file = path.join(process.cwd(), "docs/BUILD_LOG.md")): BuildEntry[] {
  return parseBuildLog(readFileSync(file, "utf8"));
}

export function chicagoDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(parsed) + " Chicago";
}
