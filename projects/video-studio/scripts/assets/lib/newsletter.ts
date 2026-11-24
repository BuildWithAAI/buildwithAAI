/**
 * (d) NEWSLETTER: runs creator-hub's newsletter tool (`npm run newsletter -- draft <kit.json>`, documented in
 * creator-hub/tools/newsletter/README.md) and records what it printed and wrote. It never passes --kit-draft, so
 * nothing reaches Kit.
 * The tool reads a publish kit. When scripts/publish-kit has not written one yet, this module writes a PublishKit-shaped
 * adapter kit from the storyboard and timeline (newsletter/kit.assets.json) and says so in the manifest; a real kit
 * always wins.
 */
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {PublishKit} from './types.ts';

export type NewsletterRun = {
	command: string[];
	cwd: string;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	files: string[];
};

export const newsletterAvailable = (hubRoot: string): boolean => {
	if (!existsSync(join(hubRoot, 'tools/newsletter/cli.ts'))) return false;
	try {
		const pkg = JSON.parse(readFileSync(join(hubRoot, 'package.json'), 'utf8')) as {scripts?: Record<string, string>};
		return typeof pkg.scripts?.newsletter === 'string';
	} catch {
		return false;
	}
};

export type AdapterKitInput = {
	channel: string;
	slug: string;
	youtubeId: string | null;
	title: string;
	summary: string;
	chapters: {start: string; title: string}[];
	sources: {title: string; url: string}[];
	offers: {id: string; hubUrl: string; disclosure: string}[];
	disclosures: string[];
	generatedAt: string;
};

const post = (text: string, limit: number, note: string) => ({text, charCount: [...text].length, limit, notes: [note]});

export const adapterKit = (k: AdapterKitInput): PublishKit => {
	const note = 'Written by scripts/assets for the newsletter only; scripts/publish-kit writes the real kit.';
	const short = k.summary.length > 100 ? `${k.summary.slice(0, 99)}…` : k.summary;
	return {
		version: 1,
		channel: k.channel,
		slug: k.slug,
		youtubeVideoId: k.youtubeId,
		title: k.title,
		titleOptions: [k.title],
		summary: k.summary,
		chapters: k.chapters,
		sources: k.sources,
		offers: k.offers,
		disclosures: k.disclosures,
		posts: {
			youtube: post(k.summary, 5000, note),
			shorts: post(short, 100, note),
			tiktok: post(k.summary.slice(0, 2200), 2200, note),
			reels: post(k.summary.slice(0, 2200), 2200, note),
			x: post(short, 280, note),
			instagram: post(k.summary.slice(0, 2200), 2200, note),
		},
		captions: {srt: null, vtt: null},
		renders: [],
		settings: {
			madeForKids: false,
			containsSyntheticMedia: false,
			paidPromotion: k.offers.length > 0,
			reasons: ['Adapter kit (scripts/assets): settings are decided by the publish kit, not here.'],
		},
		checks: [{id: 'adapter-kit', ok: true, detail: note}],
		generatedAt: k.generatedAt,
	};
};

export type RunOptions = {hubRoot: string; kitPath: string; outDir: string; hubOrigin: string; offersPath: string | null; youtubeId: string | null; brand: string};

export const runNewsletter = (o: RunOptions): NewsletterRun => {
	const args = ['draft', o.kitPath, '--out', o.outDir, '--hub', o.hubOrigin, '--brand', o.brand];
	if (o.offersPath) args.push('--offers', o.offersPath);
	if (o.youtubeId) args.push('--youtube-id', o.youtubeId);
	let command = ['npm', 'run', '--silent', 'newsletter', '--', ...args];
	let r = spawnSync(command[0], command.slice(1), {cwd: o.hubRoot, encoding: 'utf8', env: {...process.env, INIT_CWD: o.hubRoot}, maxBuffer: 16 * 1024 * 1024});
	if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') {
		// no npm on PATH (some CI images): run the same CLI with this Node
		command = [process.execPath, 'tools/newsletter/cli.ts', ...args];
		r = spawnSync(command[0], command.slice(1), {cwd: o.hubRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
	}
	const files = [join(o.outDir, `${readSlug(o.kitPath)}.md`), join(o.outDir, `${readSlug(o.kitPath)}.html`)].filter((f) => existsSync(f));
	return {command, cwd: o.hubRoot, exitCode: r.status, stdout: r.stdout ?? '', stderr: r.error ? String(r.error.message) : (r.stderr ?? ''), files};
};

const readSlug = (kitPath: string): string => {
	try {
		const slug = (JSON.parse(readFileSync(kitPath, 'utf8')) as {slug?: unknown}).slug;
		return typeof slug === 'string' ? slug : 'unknown';
	} catch {
		return 'unknown';
	}
};
