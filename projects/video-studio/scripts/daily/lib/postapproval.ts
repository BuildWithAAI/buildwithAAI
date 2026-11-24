/**
 * After approval: the auto-announcer posts and the daily "Threat Brief" email. Built only from text the gates
 * checked (the approved title, narration sentences, analysis and One Fix) plus source names and links; "also on the
 * radar" lists other stories by name, status and coverage only, with no claims.
 *
 * The creator-hub tools (tools/announcer, tools/threat-brief) did not exist when this was written (2026-11-24). Until
 * they land, local drafts are written here and nothing is sent. When a tool exists it is called with
 *   node <hub>/tools/<tool>/cli.ts --input <json> --out <dir> [--dry-run]
 * (override with DAILY_ANNOUNCER_CMD / DAILY_THREAT_BRIEF_CMD: a JSON argv with {input} {out} {dryRun}), and runs live
 * only when its credentials are set and the video's YouTube id is known; otherwise --dry-run.
 */
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {esc, link, plain, safeUrl} from './escape.ts';
import type {Exec} from './exec.ts';
import {minutes, outputTail} from './exec.ts';
import type {PostApprovalResult} from './types.ts';
import {clip, shortDate, writeAtomic, writeJson} from './util.ts';

export type RadarMention = {name: string; status: 'confirmed' | 'developing'; coverage: Array<{publisher: string; url: string}>};

export type PostInput = {
	slug: string;
	date: string;
	title: string;
	shortTitle: string;
	developing: boolean;
	summary: string;
	whatWeKnow: Array<{text: string; sources: Array<{publisher: string; url: string}>}>;
	analysis: string[];
	oneFix: string | null;
	sources: Array<{publisher: string; title: string; url: string}>;
	corrections: string[];
	youtubeId: string | null;
	alsoOnRadar: RadarMention[];
	showName: string;
	displayName: string;
};

export const PLACEHOLDER_LINK = '[video link: added after the manual upload]';

export const watchUrl = (p: PostInput): string | null => (p.youtubeId ? `https://youtu.be/${p.youtubeId}` : null);

/** X's weighted length: every URL counts 23 (twitter-text); other characters count 1 here (we write ASCII-heavy text). */
export const xLength = (s: string): number => s.replace(/https?:\/\/\S+/g, 'x'.repeat(23)).length;

export const buildAnnouncements = (p: PostInput): {x: string; telegram: string; community: string} => {
	const url = watchUrl(p) ?? PLACEHOLDER_LINK;
	const head = `${p.developing ? 'DEVELOPING: ' : ''}${plain(p.shortTitle || p.title)}`;
	const first = plain(p.summary.split(/(?<=[.!?])\s+/)[0] ?? '');
	let x = `${head}\n\n${first}\n\n${url}`;
	if (xLength(x) > 270) x = `${head}\n\n${clip(first, Math.max(40, 270 - xLength(`${head}\n\n\n\n${url}`)))}\n\n${url}`;
	if (xLength(x) > 280) x = `${clip(head, 200)}\n\n${url}`;
	const sources = [...new Set(p.sources.map((s) => plain(s.publisher)))].join(', ');
	const telegram = [
		head,
		'',
		plain(p.summary),
		...(p.analysis.length ? ['', `What we found: ${plain(p.analysis[0])}`] : []),
		...(p.oneFix ? ['', `Zoo's One Fix: ${plain(p.oneFix)}`] : []),
		'',
		`Watch: ${url}`,
		`Sources: ${sources}`,
		...(p.developing ? ['', 'This is a developing story. Corrections will be pinned under the video.'] : []),
	].join('\n');
	const community = [head, '', plain(p.summary), '', `Watch: ${url}`, ...(p.developing ? ['', 'Developing story: corrections will be pinned.'] : [])].join('\n');
	return {x, telegram, community};
};

export type ThreatBrief = {subject: string; preview: string; text: string; md: string; html: string};

export const buildThreatBrief = (p: PostInput): ThreatBrief => {
	const url = watchUrl(p);
	const subject = clip(`Threat Brief, ${shortDate(p.date)}: ${p.developing ? 'DEVELOPING: ' : ''}${plain(p.title)}`, 100);
	const preview = clip(plain(p.summary.split(/(?<=[.!?])\s+/)[0] ?? p.title), 140);
	const others = p.alsoOnRadar.slice(0, 4);
	// plain text
	const t: string[] = [subject, '', ...(p.developing ? ['DEVELOPING STORY: details may change. Corrections will be pinned under the video.', ''] : [])];
	t.push('WHAT WE KNOW');
	for (const w of p.whatWeKnow) t.push(`- ${plain(w.text)} (${w.sources.map((s) => plain(s.publisher)).join(', ')})`);
	if (p.analysis.length) t.push('', 'OUR ANALYSIS', ...p.analysis.map((a) => `- ${plain(a)}`));
	if (p.oneFix) t.push('', "ZOO'S ONE FIX", plain(p.oneFix));
	t.push('', `WATCH: ${url ?? PLACEHOLDER_LINK}`);
	if (p.corrections.length) t.push('', 'CORRECTIONS', ...p.corrections.map((c) => `- ${plain(c)}`));
	if (others.length) {
		t.push('', 'ALSO ON THE RADAR (not covered today; follow the links for details)');
		for (const o of others) t.push(`- ${plain(o.name)} (${o.status}): ${o.coverage.map((c) => `${plain(c.publisher)} ${safeUrl(c.url) ?? ''}`.trim()).join('; ')}`);
	}
	t.push('', 'SOURCES', ...p.sources.map((s) => `- ${plain(s.publisher)}: ${plain(s.title)} ${safeUrl(s.url) ?? ''}`.trim()));
	t.push('', `You get the Threat Brief because you subscribed to ${plain(p.displayName)}. We never DM you first, and we never ask for a seed phrase or a wallet connection. Not financial advice.`);
	const text = t.join('\n');
	// markdown (front matter, like the newsletter tool's drafts)
	const mdLines = ['---', `subject: ${JSON.stringify(subject)}`, `preview: ${JSON.stringify(preview)}`, '---', '', text.split('\n').slice(2).join('\n')];
	// email-safe HTML: inline styles, no scripts, images, fonts or tracking; every value escaped
	const P = 'margin:0 0 12px;font:16px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0B0C0F';
	const H = 'margin:20px 0 8px;font:700 13px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#161A21';
	const li = (s: string) => `<li style="${P}">${s}</li>`;
	const h: string[] = [];
	h.push('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>', esc(subject), '</title></head>');
	h.push('<body style="margin:0;padding:0;background:#E6E8EB"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E6E8EB"><tr><td align="center" style="padding:16px">');
	h.push('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#F4F6F8;border-radius:8px"><tr><td style="padding:24px">');
	h.push(`<div style="display:none;max-height:0;overflow:hidden">${esc(preview)}</div>`);
	h.push(`<p style="${H}">${esc(p.showName)} · Threat Brief · ${esc(shortDate(p.date))}</p>`);
	h.push(`<h1 style="margin:0 0 12px;font:700 22px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0B0C0F">${esc(p.title)}</h1>`);
	if (p.developing) h.push(`<p style="${P};padding:8px 12px;background:#161A21;color:#F4F6F8;border-radius:6px"><strong>DEVELOPING STORY.</strong> Details may change. Corrections will be pinned under the video.</p>`);
	h.push(`<p style="${H}">What we know</p><ul style="padding-left:20px;margin:0">`);
	for (const w of p.whatWeKnow) h.push(li(`${esc(w.text)} <span style="color:#555">(${w.sources.map((s) => link(s.url, s.publisher)).join(', ')})</span>`));
	h.push('</ul>');
	if (p.analysis.length) h.push(`<p style="${H}">Our analysis</p>`, ...p.analysis.map((a) => `<p style="${P}">${esc(a)}</p>`));
	if (p.oneFix) h.push(`<p style="${H}">Zoo's One Fix</p><p style="${P}">${esc(p.oneFix)}</p>`);
	h.push(
		url
			? `<p style="${P}"><a href="${esc(url)}" style="display:inline-block;padding:10px 16px;background:#29B8AD;color:#0B0C0F;text-decoration:none;border-radius:6px;font-weight:700">Watch the Short</a></p>`
			: `<p style="${P}"><strong>${esc(PLACEHOLDER_LINK)}</strong></p>`,
	);
	if (p.corrections.length) h.push(`<p style="${H}">Corrections</p><ul style="padding-left:20px;margin:0">${p.corrections.map((c) => li(esc(c))).join('')}</ul>`);
	if (others.length) {
		h.push(`<p style="${H}">Also on the radar</p><p style="${P};font-size:14px;color:#555">Not covered today. Follow the links for the details.</p><ul style="padding-left:20px;margin:0">`);
		for (const o of others) h.push(li(`${esc(o.name)} <em>(${esc(o.status)})</em>: ${o.coverage.map((c) => link(c.url, c.publisher)).join(', ')}`));
		h.push('</ul>');
	}
	h.push(`<p style="${H}">Sources</p><ul style="padding-left:20px;margin:0">${p.sources.map((s) => li(`${esc(s.publisher)}: ${link(s.url, s.title)}`)).join('')}</ul>`);
	h.push(`<p style="${P};font-size:13px;color:#555;margin-top:20px">You get the Threat Brief because you subscribed to ${esc(p.displayName)}. We never DM you first, and we never ask for a seed phrase or a wallet connection. Not financial advice.</p>`);
	h.push('</td></tr></table></td></tr></table></body></html>');
	return {subject, preview, text, md: mdLines.join('\n'), html: h.join('')};
};

export const hubToolCli = (hubRoot: string, tool: 'announcer' | 'threat-brief'): string => join(hubRoot, 'tools', tool, 'cli.ts');

const ENV_CMD = {announcer: 'DAILY_ANNOUNCER_CMD', 'threat-brief': 'DAILY_THREAT_BRIEF_CMD'} as const;

/**
 * Writes the local drafts for one tool, then calls the hub tool if it exists (dry-run unless live). Never throws:
 * a failing hub call is reported and the local drafts stay.
 */
export const runPostApproval = (o: {
	tool: 'announcer' | 'threat-brief';
	outDir: string;
	hubRoot: string;
	root: string;
	files: Record<string, string>;
	input: unknown;
	credentialEnv: string[];
	videoKnown: boolean;
	exec: Exec;
	env: NodeJS.ProcessEnv;
}): PostApprovalResult => {
	const dir = join(o.outDir, o.tool);
	const written: string[] = [];
	for (const [name, content] of Object.entries(o.files)) {
		writeAtomic(join(dir, name), content);
		written.push(join(dir, name));
	}
	const inputPath = join(dir, 'input.json');
	writeJson(inputPath, o.input);
	written.push(inputPath);
	const cli = hubToolCli(o.hubRoot, o.tool);
	const override = o.env[ENV_CMD[o.tool]];
	if (!override && !existsSync(cli))
		return {id: o.tool, mode: 'local-draft', status: 'written', note: `creator-hub/tools/${o.tool} does not exist yet: local drafts only, nothing sent.`, files: written};
	const creds = o.credentialEnv.length > 0 && o.credentialEnv.every((k) => !!o.env[k]);
	const live = creds && o.videoKnown;
	let argv: string[];
	if (override) {
		try {
			const arr = JSON.parse(override) as unknown;
			if (!Array.isArray(arr) || !arr.length || arr.some((x) => typeof x !== 'string')) throw new Error('not a JSON array of strings');
			argv = (arr as string[]).flatMap((s) => (s === '{dryRun}' ? (live ? [] : ['--dry-run']) : [s.replace('{input}', inputPath).replace('{out}', dir)]));
		} catch (err) {
			return {id: o.tool, mode: 'local-draft', status: 'failed', note: `${ENV_CMD[o.tool]} is not a JSON argv (${err instanceof Error ? err.message : String(err)}); local drafts only.`, files: written};
		}
	} else argv = [process.execPath, cli, '--input', inputPath, '--out', dir, ...(live ? [] : ['--dry-run'])];
	const r = o.exec({cmd: argv[0], args: argv.slice(1), cwd: o.root, env: o.env, timeoutMs: minutes(5)});
	const ok = r.status === 0 && !r.error;
	const why = live ? 'live: credentials set and the video id is known' : !creds ? `dry-run: ${o.credentialEnv.length ? `credentials not set (${o.credentialEnv.join(', ')})` : 'no credential names configured'}` : 'dry-run: the video is not uploaded yet (no YouTube id)';
	return {
		id: o.tool,
		mode: live ? 'hub-live' : 'hub-dry-run',
		status: ok ? 'written' : 'failed',
		note: ok ? `creator-hub/tools/${o.tool} ran (${why}).` : `creator-hub/tools/${o.tool} failed (exit ${r.status ?? 'none'}); local drafts kept. ${outputTail(r, 600)}`,
		files: written,
		command: argv,
		exitCode: r.status,
	};
};
