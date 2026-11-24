/**
 * Claim-gate check for Node tools that render a real channel's episode, thumbnails or Shorts (node:fs only; never
 * imported by the Remotion bundle, which cannot read out/). Added 2026-11-24 (review: renders never read the gate).
 *
 * A render may go ahead only when the claim gate's report for that language
 *   - exists: out/claims/<slug>.<lang>.json (written by `node scripts/claims/check.ts content/<channel>/<slug> --lang <lang>`),
 *   - passed: pass === true and errors === 0,
 *   - is about this episode: channel, slug and lang match,
 *   - is current: it was written after the last change to the storyboard it checked, the source-language storyboard
 *     (translations are checked against its claim tags) and research.md (the must-not-say list).
 * Dev fixtures (channel "_dev") are exempt. Pure checks with an injectable file system, so the tests need no files.
 */
import {existsSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import type {Lang} from '../types.ts';

export type ClaimGateFs = {exists: (p: string) => boolean; read: (p: string) => string; mtimeMs: (p: string) => number};
const realFs: ClaimGateFs = {exists: existsSync, read: (p) => readFileSync(p, 'utf8'), mtimeMs: (p) => statSync(p).mtimeMs};

export type ClaimGateInput = {studio: string; channel: string; slug: string; lang: Lang; fs?: ClaimGateFs};

export const claimReportPath = (studio: string, slug: string, lang: Lang): string => join(studio, 'out', 'claims', `${slug}.${lang}.json`);

const storyboardName = (lang: Lang) => (lang === 'en' ? 'storyboard.json' : `storyboard.${lang}.json`);

/** Problems that block the render (empty: the gate passed on the current text). */
export const claimGateProblems = ({studio, channel, slug, lang, fs = realFs}: ClaimGateInput): string[] => {
	if (channel === '_dev') return [];
	const fix = `run: node scripts/claims/check.ts content/${channel}/${slug}${lang === 'en' ? '' : ` --lang ${lang}`}`;
	const report = claimReportPath(studio, slug, lang);
	const rel = `out/claims/${slug}.${lang}.json`;
	if (!fs.exists(report)) return [`no claim-gate report at ${rel}: the claim gate has not run for ${channel}/${slug} (${lang}); ${fix}`];
	let r: {pass?: unknown; errors?: unknown; channel?: unknown; slug?: unknown; lang?: unknown; checkedAt?: unknown; file?: unknown};
	try {
		r = JSON.parse(fs.read(report)) as typeof r;
	} catch (err) {
		return [`${rel} is not valid JSON (${err instanceof Error ? err.message : String(err)}); ${fix}`];
	}
	const out: string[] = [];
	if (r.channel !== channel || r.slug !== slug || r.lang !== lang)
		out.push(`${rel} is about ${String(r.channel)}/${String(r.slug)} (${String(r.lang)}), not ${channel}/${slug} (${lang}); ${fix}`);
	if (r.pass !== true || r.errors !== 0) out.push(`the claim gate FAILED for ${channel}/${slug} (${lang}): ${String(r.errors)} error(s) in ${rel.replace(/\.json$/, '.md')}; fix the storyboard, then ${fix}`);
	const checked = typeof r.checkedAt === 'string' ? Date.parse(r.checkedAt) : NaN;
	const at = Number.isFinite(checked) ? checked : fs.mtimeMs(report);
	const dir = join(studio, 'content', channel, slug);
	const inputs = [storyboardName(lang), ...(lang === 'en' ? [] : ['storyboard.json']), 'research.md'];
	for (const f of inputs) {
		const p = join(dir, f);
		if (fs.exists(p) && fs.mtimeMs(p) > at + 1000) out.push(`content/${channel}/${slug}/${f} changed after the claim gate ran (${new Date(at).toISOString()}): ${fix}`);
	}
	return out;
};
