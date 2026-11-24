/**
 * Reads where one planned item stands now, from the files the other steps write (read only): the storyboard and its
 * dubs, the claim gate's reports (out/claims/<slug>.<lang>.json), the voice timeline, the render, the thumbnails and
 * the publish kit. Decides readiness: any blocker means NOT READY, and approve refuses an item that was not ready on
 * the page the owner saw. The same hashes are recorded by review and re-checked by approve.
 */
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {PlanItem} from './types.ts';
import {hashFile, isRecord, mtimeMs, readJson, str} from './util.ts';

export type FileState = {path: string; exists: boolean; sha256: string | null; bytes: number | null; mtimeMs: number | null};

export type Finding = {level: string; rule: string; where: string; scene: string | null; message: string; fix: string};

export type ClaimState = {
	lang: string;
	path: string;
	exists: boolean;
	pass: boolean | null;
	errors: number;
	warnings: number;
	checkedAt: string | null;
	stale: boolean;
	findings: Finding[];
	waivers: Array<{scene: string; rule: string; match: string; reason: string; used: boolean}>;
	sha256: string | null;
};

export type SourceView = {id: string; title: string; url: string; quote: string | null; accessed: string | null; status: string | null};

export type SceneView = {id: string; type: string; segment: string | null; text: string; refs: string[]; onScreen: string[]};

export type DubState = {lang: string; storyboard: FileState; status: string | null; reviewed: boolean; claims: ClaimState; timeline: {exists: boolean; mode: string | null}; ready: boolean; notes: string[]};

export type ItemState = {
	item: PlanItem;
	storyboard: FileState;
	title: string | null;
	fiction: boolean | null;
	scenes: SceneView[];
	sources: SourceView[];
	kit: FileState;
	kitTitle: string | null;
	shortText: FileState | null;
	shortTitle: string | null;
	settings: {madeForKids: boolean; containsSyntheticMedia: boolean; paidPromotion: boolean; reasons: string[]} | null;
	kitFailing: Array<{id: string; detail: string}>;
	render: FileState;
	thumbnails: FileState[];
	timeline: {exists: boolean; mock: boolean; voice: string | null};
	claims: ClaimState;
	dubs: DubState[];
	blockers: string[];
	warnings: string[];
	ready: boolean;
	/** What the owner's approval is bound to: path -> sha256 (null = missing). Review records it; approve re-checks it. */
	hashes: Record<string, string | null>;
	/** Dub files shown on the page (a changed dub needs a new review before its track is added). */
	dubHashes: Record<string, string | null>;
};

/** A path the batch may read and copy: relative, under out/ or content/ or public/, no hidden or ".." segments. */
export const safeStudioPath = (p: string): boolean => /^(out|content|public)(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)+$/.test(p) && !p.split('/').some((x) => x === '..' || x.startsWith('.'));

export const fileState = async (root: string, path: string): Promise<FileState> => {
	const abs = join(root, path);
	const h = await hashFile(abs);
	return {path, exists: !!h, sha256: h?.sha256 ?? null, bytes: h?.bytes ?? null, mtimeMs: h ? mtimeMs(abs) : null};
};

/** Narration as people read it: {display|spoken} shows the display side; [src:a,b] tags become refs. */
export const displayNarration = (narration: string): {text: string; refs: string[]} => {
	const refs: string[] = [];
	const text = narration
		.replace(/\[src:([^\]]*)\]/g, (_m, ids: string) => {
			for (const id of ids.split(',').map((s) => s.trim()).filter(Boolean)) if (!refs.includes(id)) refs.push(id);
			return '';
		})
		.replace(/\{([^{}|]*)\|[^{}]*\}/g, '$1')
		.replace(/\s+([.,;:!?])/g, '$1')
		.replace(/\s{2,}/g, ' ')
		.trim();
	return {text, refs};
};

const onScreenLines = (onScreen: unknown): string[] => {
	if (!isRecord(onScreen)) return [];
	const out: string[] = [];
	for (const [key, value] of Object.entries(onScreen)) {
		if (typeof value === 'string' && value.trim()) out.push(`${key}: ${value}`);
		else if (Array.isArray(value)) {
			const parts = value.filter((v): v is string => typeof v === 'string' && !!v.trim());
			if (parts.length) out.push(`${key}: ${parts.join(' · ')}`);
		}
	}
	return out;
};

export const readClaims = (root: string, slug: string, lang: string, storyboardMtime: number | null): ClaimState => {
	const path = `out/claims/${slug}.${lang}.json`;
	const read = readJson(join(root, path));
	const base: ClaimState = {lang, path, exists: false, pass: null, errors: 0, warnings: 0, checkedAt: null, stale: false, findings: [], waivers: [], sha256: null};
	if (!read.ok) return base;
	const d = read.data;
	if (!isRecord(d) || d.tool !== 'claims/check') return {...base, exists: true, sha256: read.sha256};
	const checkedAt = str(d.checkedAt);
	const checkedMs = checkedAt ? Date.parse(checkedAt) : NaN;
	return {
		lang,
		path,
		exists: true,
		pass: typeof d.pass === 'boolean' ? d.pass : null,
		errors: typeof d.errors === 'number' ? d.errors : 0,
		warnings: typeof d.warnings === 'number' ? d.warnings : 0,
		checkedAt,
		// the gate ran on an older storyboard (1 s tolerance for file-system timestamp precision)
		stale: storyboardMtime !== null && Number.isFinite(checkedMs) && storyboardMtime > checkedMs + 1000,
		findings: (Array.isArray(d.findings) ? d.findings : []).filter(isRecord).map((f) => ({
			level: String(f.level ?? ''),
			rule: String(f.rule ?? ''),
			where: String(f.where ?? ''),
			scene: str(f.scene),
			message: String(f.message ?? ''),
			fix: String(f.fix ?? ''),
		})),
		waivers: (Array.isArray(d.waivers) ? d.waivers : []).filter(isRecord).map((w) => ({scene: String(w.scene ?? ''), rule: String(w.rule ?? ''), match: String(w.match ?? ''), reason: String(w.reason ?? ''), used: w.used === true})),
		sha256: read.sha256,
	};
};

/** The kit's shorts-<n>.txt: "=== Short n of N ... ===", "TITLE (...):", the title, "", "DESCRIPTION (...):"... */
export const shortTitleOf = (text: string): string | null => {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	const at = lines.findIndex((l) => /^TITLE \(/.test(l));
	return at >= 0 && lines[at + 1]?.trim() ? lines[at + 1].trim() : null;
};

const claimBlockers = (c: ClaimState, label: string, content: string): string[] => {
	if (!c.exists) return [`${label}: the claim gate has not run (node scripts/claims/check.ts ${content}${c.lang === 'en' ? '' : ` --lang ${c.lang}`}).`];
	if (c.pass === null) return [`${label}: ${c.path} is not a claim gate report.`];
	if (!c.pass) return [`${label}: the claim gate FAILS with ${c.errors} error(s): fix them and run it again.`];
	if (c.stale) return [`${label}: the storyboard changed after the claim gate ran: run it again.`];
	return [];
};

export const inspectItem = async (root: string, item: PlanItem): Promise<ItemState> => {
	const blockers: string[] = [];
	const warnings: string[] = [];
	const p = item.paths;

	// storyboard
	const storyboard = await fileState(root, p.storyboard);
	let title: string | null = null;
	let fiction: boolean | null = null;
	let scenes: SceneView[] = [];
	let sources: SourceView[] = [];
	let sbShorts: Array<{id: string; sceneIds: string[]; title: string}> = [];
	if (!storyboard.exists) blockers.push(`No storyboard yet (${p.storyboard}): the writer session writes it from the WRITER packet.`);
	else {
		const read = readJson(join(root, p.storyboard));
		const d = read.ok ? read.data : null;
		if (!isRecord(d) || !Array.isArray(d.scenes)) blockers.push(`${p.storyboard} is not a storyboard (${read.ok ? 'no scenes' : read.error}).`);
		else {
			if (d.channel !== item.channel || d.slug !== item.slug) blockers.push(`${p.storyboard} says ${String(d.channel)}/${String(d.slug)}, not ${item.channel}/${item.slug}.`);
			title = str(d.title);
			fiction = typeof d.fiction === 'boolean' ? d.fiction : null;
			sbShorts = (Array.isArray(d.shorts) ? d.shorts : []).filter(isRecord).map((s) => ({id: String(s.id ?? ''), sceneIds: Array.isArray(s.sceneIds) ? s.sceneIds.map(String) : [], title: String(s.title ?? '')}));
			let wanted: string[] | null = null;
			if (item.kind === 'short') {
				const s = sbShorts[(item.shortIndex ?? 1) - 1];
				if (!s) blockers.push(`The storyboard has ${sbShorts.length} Short(s); this item is Short ${item.shortIndex}. The WRITER packet asks for one Short per planned slot, in order.`);
				else {
					wanted = s.sceneIds;
					if (s.id !== item.renderId) warnings.push(`storyboard.shorts[${(item.shortIndex ?? 1) - 1}] is "${s.id}", expected "${item.renderId}" (the kit numbers Shorts by position, so this still maps to ${item.renderId}).`);
				}
			}
			scenes = d.scenes
				.filter(isRecord)
				.filter((s) => !wanted || wanted.includes(String(s.id)))
				.map((s) => {
					const n = displayNarration(typeof s.narration === 'string' ? s.narration : '');
					return {id: String(s.id ?? '?'), type: String(s.type ?? '?'), segment: str(s.segment), text: n.text, refs: n.refs, onScreen: onScreenLines(s.onScreen)};
				});
			sources = (Array.isArray(d.sources) ? d.sources : []).filter(isRecord).map((s) => ({id: String(s.id ?? ''), title: String(s.title ?? ''), url: String(s.url ?? ''), quote: str(s.quote), accessed: str(s.accessed), status: str(s.status)}));
			if (item.kind === 'short') {
				const used = new Set(scenes.flatMap((s) => s.refs));
				sources = sources.filter((s) => used.has(s.id));
			}
			if (item.kind === 'long' && sbShorts.length < item.shortIds.length) warnings.push(`The storyboard has ${sbShorts.length} Short(s); the week plans ${item.shortIds.length} from this episode.`);
		}
	}

	// claim gate (the episode's report covers its Shorts)
	const claims = readClaims(root, item.slug, 'en', storyboard.mtimeMs);
	blockers.push(...claimBlockers(claims, 'English script', p.content));

	// voice timeline
	const timelinePath = join(root, 'public', 'generated', item.channel, item.slug, 'en', 'timeline.json');
	const tl = readJson(timelinePath);
	const timeline = {exists: tl.ok, mock: tl.ok && isRecord(tl.data) && tl.data.mock === true, voice: tl.ok && isRecord(tl.data) ? str(tl.data.voice) : null};
	const timelineMtime = mtimeMs(timelinePath);
	if (!timeline.exists) blockers.push('No English voice timeline: run the voice step (scripts/voice/build.py ... --lang en --voice im_nicola). Without it a render is silent.');
	else if (timeline.mock) blockers.push('The voice timeline is a mock (silent preview): run the voice step.');
	else if (timeline.voice && timeline.voice !== 'im_nicola') blockers.push(`The narration was voiced with ${timeline.voice}; Zoo's voice is im_nicola in every language (owner decision 2026-11-24).`);

	// publish kit
	const kit = await fileState(root, p.kit);
	let kitTitle: string | null = null;
	let settings: ItemState['settings'] = null;
	let kitFailing: ItemState['kitFailing'] = [];
	let renderPath = p.render;
	let thumbPaths = item.kind === 'long' && p.thumbnails ? [0, 1, 2].map((i) => `${p.thumbnails}/v${i}.png`) : [];
	if (!kit.exists) blockers.push(`No publish kit (${p.kit}): run node scripts/publish-kit/cli.ts ${item.channel}/${item.slug}.`);
	else {
		const read = readJson(join(root, p.kit));
		const d = read.ok ? read.data : null;
		if (!isRecord(d) || d.version !== 1) blockers.push(`${p.kit} is not a publish kit.`);
		else {
			if (d.channel !== item.channel || d.slug !== item.slug) blockers.push(`${p.kit} is for ${String(d.channel)}/${String(d.slug)}.`);
			kitTitle = str(d.title);
			if (isRecord(d.settings)) {
				const s = d.settings;
				settings = {madeForKids: s.madeForKids === true, containsSyntheticMedia: s.containsSyntheticMedia === true, paidPromotion: s.paidPromotion === true, reasons: Array.isArray(s.reasons) ? s.reasons.map(String) : []};
				if (settings.madeForKids) blockers.push('The kit marks this video made for kids. The studio default is No (adult crypto and AI content); fix episode.json.');
			}
			kitFailing = (Array.isArray(d.checks) ? d.checks : []).filter(isRecord).filter((c) => c.ok === false).map((c) => ({id: String(c.id ?? '?'), detail: String(c.detail ?? '')}));
			if (kitFailing.length) blockers.push(`Publish-kit checks fail: ${kitFailing.map((c) => c.id).join(', ')} (the uploader refuses while any check fails).`);
			const renders = (Array.isArray(d.renders) ? d.renders : []).filter(isRecord);
			const r = renders.find((x) => x.id === item.renderId);
			if (!r || typeof r.output !== 'string') blockers.push(`The kit has no render "${item.renderId}"${item.kind === 'short' ? ': episode.json shortCuts must list the Shorts in the planned order' : ''}.`);
			else if (!safeStudioPath(r.output)) blockers.push(`The kit's render "${item.renderId}" points outside out/ (${r.output}); regenerate the kit.`);
			else renderPath = r.output;
			if (item.kind === 'long') {
				const thumbs = renders.filter((x) => x.kind === 'thumbnail' && typeof x.output === 'string').map((x) => String(x.output));
				const unsafe = thumbs.filter((t) => !safeStudioPath(t));
				if (unsafe.length) blockers.push(`The kit's thumbnails point outside out/ (${unsafe.join(', ')}); regenerate the kit.`);
				else if (thumbs.length) thumbPaths = thumbs;
			}
		}
	}
	let shortText: FileState | null = null;
	let shortTitle: string | null = null;
	if (item.kind === 'short' && p.shortText) {
		shortText = await fileState(root, p.shortText);
		if (!shortText.exists) blockers.push(`${p.shortText} is missing (the kit writes the Short's title and description there).`);
		else shortTitle = shortTitleOf(readFileSync(join(root, p.shortText), 'utf8'));
	}

	// render and thumbnails
	const render = await fileState(root, renderPath);
	if (!render.exists) blockers.push(`Not rendered yet: ${renderPath} (render farm draft out/batch/<week>/${item.parentId ?? item.id}/render-request.json, or the kit's render-plan.sh).`);
	else {
		const newest = Math.max(storyboard.mtimeMs ?? 0, timelineMtime ?? 0);
		if (render.mtimeMs !== null && newest > render.mtimeMs + 1000) blockers.push('The render is older than the current storyboard or voice timeline: render it again so the preview shows this script.');
	}
	const thumbnails = item.kind === 'long' ? await Promise.all(thumbPaths.map((t) => fileState(root, t))) : [];
	if (item.kind === 'long' && !thumbnails.some((t) => t.exists)) blockers.push(`No thumbnails (${thumbPaths[0] ?? p.thumbnails}): node scripts/thumbnails.ts ${item.channel}/${item.slug} --lang en --out ${p.kitDir}/media/thumbnails.`);

	// dubs (multi-language audio tracks): reviewed here, added by hand in Studio; never a blocker for the English upload
	const dubs: DubState[] = [];
	for (const lang of item.languages.dubs) {
		const sb = await fileState(root, `${p.content}/storyboard.${lang}.json`);
		const read = sb.exists ? readJson(join(root, sb.path)) : null;
		const tr = read?.ok && isRecord(read.data) && isRecord(read.data.translation) ? read.data.translation : null;
		const status = tr ? str(tr.status) : null;
		const reviewed = tr?.reviewed === true || status === 'native-reviewed';
		const dc = readClaims(root, item.slug, lang, sb.mtimeMs);
		const dtl = readJson(join(root, 'public', 'generated', item.channel, item.slug, lang, 'timeline.json'));
		const mode = dtl.ok && isRecord(dtl.data) ? str(dtl.data.mode) : null;
		const notes: string[] = [];
		if (!sb.exists) notes.push('not translated yet (scripts/dub prepare/import)');
		else {
			notes.push(...claimBlockers(dc, 'gate', p.content).map((b) => b.replace(/^gate: /, '')));
			if (!dtl.ok) notes.push('not voiced yet (voice step --fit-to en)');
			else if (mode !== 'fit-to-master') notes.push(`voiced in "${mode ?? '?'}" mode: an audio track must fit the English picture (--fit-to en)`);
			if (!reviewed) notes.push('machine translation: needs a native review before its track is added');
		}
		const ready = sb.exists && dc.pass === true && !dc.stale && dtl.ok && mode === 'fit-to-master';
		dubs.push({lang, storyboard: sb, status, reviewed, claims: dc, timeline: {exists: dtl.ok, mode}, ready, notes});
	}

	if (fiction === false && item.format === 'pov-story') warnings.push('A POV story with fiction: false: the fiction card only shows when storyboard.fiction is true.');
	const hashes: Record<string, string | null> = {[storyboard.path]: storyboard.sha256, [kit.path]: kit.sha256, [render.path]: render.sha256, [claims.path]: claims.sha256};
	for (const t of thumbnails) hashes[t.path] = t.sha256;
	if (shortText) hashes[shortText.path] = shortText.sha256;
	const dubHashes: Record<string, string | null> = {};
	for (const d of dubs) {
		dubHashes[d.storyboard.path] = d.storyboard.sha256;
		dubHashes[d.claims.path] = d.claims.sha256;
	}
	return {
		item,
		storyboard,
		title,
		fiction,
		scenes,
		sources,
		kit,
		kitTitle,
		shortText,
		shortTitle,
		settings,
		kitFailing,
		render,
		thumbnails,
		timeline,
		claims,
		dubs,
		blockers,
		warnings,
		ready: blockers.length === 0,
		hashes,
		dubHashes,
	};
};

/** Paths whose content differs from what was recorded (missing counts as changed). */
export const changedPaths = (recorded: Record<string, string | null>, now: Record<string, string | null>): string[] => {
	const keys = new Set([...Object.keys(recorded), ...Object.keys(now)]);
	return [...keys].filter((k) => (recorded[k] ?? null) !== (now[k] ?? null)).sort();
};

export const exists = (root: string, path: string): boolean => existsSync(join(root, path));
