/**
 * review --week <w>: ONE mobile-first approval page for the whole week (out/approval/week-<w>/index.html) plus the
 * snapshot approve checks against (review.json): for every item, whether it was READY and the hashes of exactly what
 * the page showed, the upload spec and the files it names included. Thumbnails are copied next to the page; previews
 * are relative links (or copies with --copy-media). Nothing is uploaded, approved or sent.
 *
 * Every page has a page code: the first 8 hex characters of the SHA-256 of its snapshot (every hash, the readiness
 * of every item and the build time). Each reply the page offers carries it ("APPROVE 2026-W49 ai1 #93770ddb"), and
 * approve refuses a reply whose code is not the current page's, so a reply can only approve the page it answered.
 * Every snapshot is also kept as review-<code>.json: a rebuild never erases the record of a page the owner saw.
 */
import {copyFileSync, existsSync, mkdirSync} from 'node:fs';
import {basename, join, relative} from 'node:path';
import {renderReviewHtml} from './html.ts';
import {inspectItem, type ItemState} from './inspect.ts';
import {readPlan} from './plan.ts';
import type {PlanItem, Slot, WeekPlan} from './types.ts';
import {isRecord, readJson, sha256, writeJsonAtomic, writeTextAtomic} from './util.ts';
import {formatLocal} from './zone.ts';

export const approvalDir = (root: string, week: string): string => join(root, 'out', 'approval', `week-${week}`);

export type Media = {href: string | null; label: string};

export type ReviewItem = {
	state: ItemState;
	preview: Media;
	thumbs: Media[];
	/** The upload spec's thumbnail override, copied next to the page; null when there is none. */
	specThumb: Media | null;
	claimReport: string | null;
	reply: string;
	edit: string;
	studioSteps: string[];
};

export type ReviewModel = {
	week: string;
	weekStart: string;
	weekEnd: string;
	timeZone: string;
	builtAt: string;
	builtAtLocal: string;
	status: string;
	items: ReviewItem[];
	ready: string[];
	notReady: string[];
	warnings: string[];
	ownerInputs: string[];
	replyAll: string;
	planSha256: string;
	/** The page code every reply carries: the first 8 hex characters of the snapshot's SHA-256. */
	pageCode: string;
};

export type ReviewSnapshot = {
	version: 1;
	kind: 'zoora-weekly-review';
	week: string;
	builtAt: string;
	timeZone: string;
	plan: {path: string; sha256: string};
	/** code: what each reply on the page carries (see pageCodeOf); sha256: of the page's HTML. */
	page: {path: string; sha256: string; code: string};
	items: Array<{
		id: string;
		ready: boolean;
		blockers: string[];
		renderId: string;
		channel: string;
		slug: string;
		kit: string;
		slot: Slot;
		hashes: Record<string, string | null>;
		dubHashes: Record<string, string | null>;
		dubsReady: string[];
		/** The upload spec and the files it names, as shown (null = none: a spec added later is a change). */
		specHashes: Record<string, string | null>;
	}>;
};

/** "#" + 8 lowercase hex characters, as replies write it. */
export const PAGE_CODE = /^#?([0-9a-f]{8})$/i;

/** The page code: the first 8 hex characters of the SHA-256 of the snapshot (everything except the page itself). */
export const pageCodeOf = (snapshot: Omit<ReviewSnapshot, 'page'>): string => sha256(JSON.stringify(snapshot)).slice(0, 8);

/** The snapshot of every page built for a week, by code (review-<code>.json). */
export const archivedSnapshotPath = (root: string, week: string, code: string): string => join(approvalDir(root, week), `review-${code.toLowerCase()}.json`);

/** What stays a manual YouTube Studio step for an item (uploader README, "Studio steps"). */
export const studioSteps = (item: PlanItem, state: ItemState, plan: WeekPlan): string[] => {
	const steps: string[] = [];
	if (state.settings?.paidPromotion) steps.push('Tick "paid promotion" (the uploader leaves it to Studio).');
	if (item.kind === 'long') {
		const ready = state.dubs.filter((d) => d.ready && d.reviewed).map((d) => d.lang);
		if (item.languages.dubs.length) steps.push(`Dub tracks (Languages > Add language > Dub): ${ready.length ? `add ${ready.join(', ')}` : 'none ready yet'}${ready.length < item.languages.dubs.length ? `; ${item.languages.dubs.filter((l) => !ready.includes(l)).join(', ')} only after its native review and a new page` : ''}. Delete YouTube's auto-dub for a language before adding ours.`);
		steps.push('Localized thumbnails (es, pt-BR) and the end screen.');
	} else {
		const parent = plan.items.find((i) => i.id === item.parentId);
		steps.push(`Set the Short's Related video to ${parent ? `"${parent.title}" (${parent.id})` : 'its episode'} once that episode is public.`);
	}
	steps.push('Pin the comment from the kit (pinned-comment.txt).');
	return steps;
};

/** The uploader's channels.json: what the owner must still decide before approve can work. */
export const uploaderInputs = (root: string, hub: string, channels: string[], channelsPath: string | null = null): string[] => {
	const path = channelsPath ?? join(root, hub, 'tools', 'uploader', 'channels.json');
	const read = readJson(path);
	if (!read.ok || !isRecord(read.data) || !isRecord(read.data.channels)) return [`The uploader's channels.json was not found at ${relative(root, path)}: approve needs the uploader (creator-hub/tools/uploader).`];
	const out: string[] = [];
	for (const ch of channels) {
		const c = read.data.channels[ch];
		if (!isRecord(c)) out.push(`Uploader: channel "${ch}" is not in creator-hub/tools/uploader/channels.json.`);
		else if (!c.categoryId) out.push(`Uploader: no YouTube category is set for ${ch} (categoryId in creator-hub/tools/uploader/channels.json). Approve refuses until you choose one: an owner decision ("node tools/uploader/cli.ts categories" lists them).`);
	}
	return out;
};

const copyInto = (root: string, from: string, dir: string, name: string): string | null => {
	const src = join(root, from);
	if (!existsSync(src)) return null;
	mkdirSync(dir, {recursive: true});
	copyFileSync(src, join(dir, name));
	return join(dir, name);
};

export type ReviewOptions = {root: string; week: string; hub: string; channelsPath?: string | null; nowMs: number; copyMedia: boolean; log: (line: string) => void};

export const buildReview = async (o: ReviewOptions): Promise<{model: ReviewModel; snapshot: Omit<ReviewSnapshot, 'page'>; pageDir: string}> => {
	const {plan, sha256: planSha, path: planPath} = readPlan(o.root, o.week);
	const pageDir = approvalDir(o.root, o.week);
	const items: ReviewItem[] = [];
	for (const item of plan.items) {
		const state = await inspectItem(o.root, item);
		const mediaDir = join(pageDir, 'media', item.id);
		let previewHref: string | null = null;
		if (state.render.exists) {
			if (o.copyMedia) {
				const copied = copyInto(o.root, state.render.path, mediaDir, basename(state.render.path));
				previewHref = copied ? relative(pageDir, copied).split('\\').join('/') : null;
			} else previewHref = relative(pageDir, join(o.root, state.render.path)).split('\\').join('/');
		}
		const thumbs: Media[] = [];
		for (const t of state.thumbnails) {
			if (!t.exists) continue;
			const copied = copyInto(o.root, t.path, mediaDir, basename(t.path));
			if (copied) thumbs.push({href: relative(pageDir, copied).split('\\').join('/'), label: basename(t.path)});
		}
		let specThumb: Media | null = null;
		const override = state.spec?.thumbnail;
		if (override?.path && override.file?.exists) {
			const copied = copyInto(o.root, override.path, join(mediaDir, 'spec'), basename(override.path));
			if (copied) specThumb = {href: relative(pageDir, copied).split('\\').join('/'), label: override.path};
		}
		const mdReport = state.claims.exists ? state.claims.path.replace(/\.json$/, '.md') : null;
		items.push({
			state,
			preview: {href: previewHref, label: state.render.path},
			thumbs,
			specThumb,
			claimReport: mdReport && existsSync(join(o.root, mdReport)) ? relative(pageDir, join(o.root, mdReport)).split('\\').join('/') : null,
			reply: '',
			edit: `EDIT ${item.id}: <what to change>`,
			studioSteps: studioSteps(item, state, plan),
		});
	}
	const ready = items.filter((i) => i.state.ready).map((i) => i.state.item.id);
	const builtAt = new Date(o.nowMs).toISOString();
	const snapshot: Omit<ReviewSnapshot, 'page'> = {
		version: 1,
		kind: 'zoora-weekly-review',
		week: plan.week,
		builtAt,
		timeZone: plan.timeZone,
		plan: {path: relative(o.root, planPath).split('\\').join('/'), sha256: planSha},
		items: items.map(({state}) => ({
			id: state.item.id,
			ready: state.ready,
			blockers: state.blockers,
			renderId: state.item.renderId,
			channel: state.item.channel,
			slug: state.item.slug,
			kit: state.item.paths.kit,
			slot: state.item.slot,
			hashes: state.hashes,
			dubHashes: state.dubHashes,
			dubsReady: state.dubs.filter((d) => d.ready && d.reviewed).map((d) => d.lang),
			specHashes: state.specHashes,
		})),
	};
	const code = pageCodeOf(snapshot);
	for (const r of items) r.reply = `APPROVE ${plan.week} ${r.state.item.id} #${code}`;
	const model: ReviewModel = {
		week: plan.week,
		weekStart: plan.weekStart,
		weekEnd: plan.weekEnd,
		timeZone: plan.timeZone,
		builtAt,
		builtAtLocal: formatLocal(o.nowMs, plan.timeZone),
		status: plan.status,
		items,
		ready,
		notReady: items.filter((i) => !i.state.ready).map((i) => i.state.item.id),
		warnings: plan.warnings,
		ownerInputs: uploaderInputs(o.root, o.hub, [...new Set(plan.items.map((i) => i.channel))], o.channelsPath ?? null),
		replyAll: `APPROVE ${plan.week} all #${code}`,
		planSha256: planSha,
		pageCode: code,
	};
	return {model, snapshot, pageDir};
};

export const runReview = async (o: ReviewOptions): Promise<{model: ReviewModel; pagePath: string; snapshotPath: string}> => {
	const {model, snapshot, pageDir} = await buildReview(o);
	const html = renderReviewHtml(model);
	const pagePath = join(pageDir, 'index.html');
	writeTextAtomic(pagePath, html);
	const snapshotPath = join(pageDir, 'review.json');
	const full: ReviewSnapshot = {...snapshot, page: {path: relative(o.root, pagePath).split('\\').join('/'), sha256: sha256(html), code: model.pageCode}};
	// the archive copy first: a page the owner may answer always has its record, whatever is built after it
	writeJsonAtomic(archivedSnapshotPath(o.root, model.week, model.pageCode), full);
	writeJsonAtomic(snapshotPath, full);
	o.log(`${model.items.length} item(s): ${model.ready.length} ready, ${model.notReady.length} not ready. Page: ${relative(o.root, pagePath)} (page code #${model.pageCode})`);
	for (const i of model.items) o.log(`${i.state.ready ? 'READY    ' : 'NOT READY'} ${i.state.item.id.padEnd(9)} ${i.state.item.slot.local}  ${i.state.blockers[0] ?? ''}`);
	return {model, pagePath, snapshotPath};
};
