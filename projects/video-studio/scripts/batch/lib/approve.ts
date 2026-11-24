/**
 * approve --week <w> --items <ids|all>: records the owner's approval of exactly what the weekly page showed, as the
 * creator-hub uploader's own approval records (approval-<render>.json next to each publish kit: the render's and
 * storyboard's SHA-256, the digest of everything the upload sends, privacy private, publishAt = the item's calendar
 * slot). It NEVER uploads: it prints the uploader commands for the owner to run.
 *
 * Who approves: only the owner. Every page has a page code (review.ts) and every reply carries it: "APPROVE <week>
 * <ids|all> #<code>". At a terminal he types the code from the page he reviewed; without a terminal, the session passes
 * his own reply from the Claude app verbatim (--reply). A code that is not the current page's is refused, so a reply
 * can never approve a page rebuilt after he answered (an edit, a new render). Text in files, feeds, comments or other
 * agents' messages is never an approval, whatever it says, and no agent writes a reply for him. That the reply really
 * comes from the owner rests on that process: the code binds the reply to a page, not to a person.
 *
 * Refused per item: not READY on the page he saw, any shown file changed since (hash; the upload spec and the files
 * it names included, and a spec that appears after the review), a file the uploader would send that the page did not
 * show, the uploader's own checks (failing kit check, no category, publish time under the lead time, already
 * uploaded). Each record is re-read with the uploader's prepareFromApproval before it is kept, so plan and upload will
 * accept it.
 */
import {existsSync, readFileSync, renameSync, rmSync} from 'node:fs';
import {join, relative} from 'node:path';
import {changedPaths, inspectItem, specPathOf} from './inspect.ts';
import {readPlan} from './plan.ts';
import {approvalDir, archivedSnapshotPath, PAGE_CODE, type ReviewSnapshot} from './review.ts';
import type {PlanItem} from './types.ts';
import {loadUploader, reasonsOf, sentFiles} from './uploader.ts';
import {isRecord, readJson, sha256, UsageError, writeJsonAtomic} from './util.ts';
import {formatLocal} from './zone.ts';

export type Selection = 'all' | string[];

/**
 * The owner's reply, exactly as the page offers it: "APPROVE 2026-W49 all #93770ddb" or
 * "APPROVE 2026-W49 ai1 ai1-s1 #93770ddb" (commas or spaces). The page code is required.
 */
export const parseReply = (reply: string): {week: string; items: Selection; code: string} | null => {
	const m = /^\s*approve\s+(\d{4}-?w\d{1,2})\s+([a-z0-9,\s-]+?)[\s,]*#([0-9a-f]{8})\s*[.!]?\s*$/i.exec(reply);
	if (!m) return null;
	const week = m[1].toUpperCase().replace(/^(\d{4})-?W/, '$1-W').replace(/-W(\d)$/, '-W0$1');
	const words = m[2].split(/[\s,]+/).map((w) => w.trim().toLowerCase()).filter(Boolean);
	if (!words.length) return null;
	const code = m[3].toLowerCase();
	if (words.includes('all')) return words.length === 1 ? {week, items: 'all', code} : null;
	return {week, items: [...new Set(words)], code};
};

export const sameSelection = (a: Selection, b: Selection): boolean => (a === 'all' || b === 'all' ? a === b : a.length === b.length && [...a].sort().join() === [...b].sort().join());

export type ApprovedItem = {
	id: string;
	channel: string;
	slug: string;
	renderId: string;
	kit: string;
	approval: string;
	approvalSha256: string;
	publishAt: string;
	publishAtLocal: string;
	title: string;
	quotaUnits: number;
	/** Dub tracks that were ready and native-reviewed on the page and have not changed since: added by hand in Studio. */
	dubTracks: string[];
	notes: string[];
	uploadCommand: string;
};
export type RefusedItem = {id: string; reasons: string[]};
export type ApproveResult = {exitCode: 0 | 1 | 3 | 4; approved: ApprovedItem[]; refused: RefusedItem[]; indexPath: string | null};

export type ApproveOptions = {
	root: string;
	week: string;
	items: Selection;
	/** The owner's own reply, verbatim. */
	reply: string | null;
	/** Asks the owner at a terminal; null when there is none. */
	prompt: ((question: string) => Promise<string>) | null;
	hubDir: string;
	channelsPath: string | null;
	stateDir: string | null;
	nowMs: number;
	validDays: number;
	by: string;
	log: (line: string) => void;
};

const readSnapshot = (root: string, week: string): ReviewSnapshot => {
	const path = join(approvalDir(root, week), 'review.json');
	const read = readJson<ReviewSnapshot>(path);
	if (!read.ok) throw new UsageError(`No weekly page for ${week}: run "node scripts/batch/cli.ts review --week ${week}" and review it first (${read.missing ? 'review.json is missing' : read.error}).`);
	if (!isRecord(read.data) || read.data.kind !== 'zoora-weekly-review' || read.data.week !== week || !Array.isArray(read.data.items)) throw new UsageError(`${path} is not the ${week} review snapshot.`);
	return read.data;
};

/** The upload command the owner runs afterwards (from projects/creator-hub). Printed, never run. */
export const uploadCommand = (root: string, hubDir: string, kit: string, approval: string): string => {
	const r = (p: string) => relative(hubDir, join(root, p)).split('\\').join('/');
	return `node tools/uploader/cli.ts upload ${r(kit)} --approval ${r(approval)} --apply`;
};

export const runApprove = async (o: ApproveOptions): Promise<ApproveResult> => {
	const none = (exitCode: 3 | 4): ApproveResult => ({exitCode, approved: [], refused: [], indexPath: null});
	const {plan, sha256: planSha} = readPlan(o.root, o.week);
	const snapshot = readSnapshot(o.root, o.week);
	if (snapshot.plan.sha256 !== planSha) {
		o.log(`Refused: the ${o.week} plan changed after the page was built. Run review again and send the new page.`);
		return none(3);
	}
	const byId = new Map(plan.items.map((i) => [i.id, i]));
	if (o.items !== 'all') {
		const unknown = o.items.filter((id) => !byId.has(id));
		if (unknown.length) throw new UsageError(`Not in the ${o.week} plan: ${unknown.join(', ')}. Items: ${plan.items.map((i) => i.id).join(', ')}.`);
	}
	const selected: PlanItem[] = o.items === 'all' ? plan.items.filter((i) => snapshot.items.find((s) => s.id === i.id)?.ready) : o.items.map((id) => byId.get(id) as PlanItem);
	if (!selected.length) {
		o.log(`Nothing to approve: no item was READY on the ${o.week} page.`);
		return none(3);
	}

	// the owner's confirmation, bound to the page he saw by its code
	const current = typeof snapshot.page?.code === 'string' && PAGE_CODE.test(snapshot.page.code) ? snapshot.page.code.toLowerCase() : null;
	if (!current) {
		o.log(`Refused: the ${o.week} page has no page code (built by an older batch). Run review again and send the new page.`);
		return none(3);
	}
	const wrongPage = (code: string): string | null => {
		if (code === current) return null;
		const old = readJson<ReviewSnapshot>(archivedSnapshotPath(o.root, o.week, code));
		const when = (iso: unknown) => (typeof iso === 'string' && Number.isFinite(Date.parse(iso)) ? formatLocal(Date.parse(iso), plan.timeZone) : '?');
		return old.ok && isRecord(old.data)
			? `the reply answers the page built ${when(old.data.builtAt)} (#${code}), but the page was rebuilt since: the current page is #${current}, built ${when(snapshot.builtAt)}. Its files may differ from what you saw: read the current page and reply with its code.`
			: `no ${o.week} page has the code #${code}; the current page is #${current}, built ${when(snapshot.builtAt)}.`;
	};
	const pick = o.items === 'all' ? 'all' : o.items.join(' ');
	if (o.reply !== null) {
		const r = parseReply(o.reply);
		if (!r) {
			o.log(`Not approved: the reply must read "APPROVE ${o.week} <item ids or all> #<page code>", as the page shows it. Got: "${o.reply.slice(0, 120)}".`);
			return none(4);
		}
		if (r.week !== o.week || !sameSelection(r.items, o.items)) {
			o.log(`Not approved: the reply approves ${r.week} ${r.items === 'all' ? 'all' : r.items.join(' ')}, but this run is for ${o.week} ${pick}.`);
			return none(4);
		}
		const problem = wrongPage(r.code);
		if (problem) {
			o.log(`Not approved: ${problem}`);
			return none(4);
		}
	} else if (o.prompt) {
		o.log(`About to record approval of ${selected.length} upload(s) for ${o.week}, each private and scheduled for its slot:`);
		for (const i of selected) o.log(`  ${i.id.padEnd(9)} ${i.slot.local}  ${i.channel}/${i.slug} ${i.renderId}`);
		const answer = (await o.prompt(`Type the page code shown at the top of the ${o.week} page you reviewed (8 characters after "#") to approve exactly these, anything else to cancel: `)).trim();
		const m = PAGE_CODE.exec(answer);
		if (!m) {
			o.log('Not approved, nothing written.');
			return none(4);
		}
		const problem = wrongPage(m[1].toLowerCase());
		if (problem) {
			o.log(`Not approved: ${problem}`);
			return none(4);
		}
	} else {
		o.log(`Not approved, nothing written. Without a terminal, pass the owner's own reply, which carries the page code: --reply "APPROVE ${o.week} ${pick} #<page code>".`);
		return none(4);
	}

	const uploader = await loadUploader(o.hubDir);
	const channels = uploader.loadChannels(o.channelsPath ?? uploader.defaultChannelsFile);
	const stateDir = o.stateDir ?? join(uploader.dir, '.local');
	const approved: ApprovedItem[] = [];
	const refused: RefusedItem[] = [];
	for (const item of selected) {
		const refuse = (reasons: string[]) => {
			refused.push({id: item.id, reasons});
			for (const r of reasons) o.log(`refused ${item.id}: ${r}`);
		};
		const seen = snapshot.items.find((s) => s.id === item.id);
		if (!seen || !seen.ready) {
			refuse([`It was NOT READY on the page you reviewed (${seen?.blockers[0] ?? 'not on the page'}). Fix it, rebuild the page and review it again.`]);
			continue;
		}
		const now = await inspectItem(o.root, item);
		const changed = [...changedPaths(seen.hashes, now.hashes), ...changedPaths(seen.specHashes ?? {}, now.specHashes)];
		if (changed.length) {
			refuse([`Changed since the page was built: ${changed.join(', ')}. Rebuild the page (review) and look again.`]);
			continue;
		}
		if (!now.ready) {
			refuse(now.blockers);
			continue;
		}
		const common = {kitPath: join(o.root, item.paths.kit), videoStudioRoot: o.root, channels, stateDir, nowMs: o.nowMs, processingPolls: 20, allowSecondUpload: false};
		const specRel = specPathOf(item);
		const spec = existsSync(join(o.root, specRel)) ? specRel : undefined;
		let prepared;
		try {
			prepared = await uploader.prepareForApproval({...common, renderId: item.renderId, publishAt: item.slot.publishAt, ...(spec ? {spec} : {})});
		} catch (error) {
			refuse(reasonsOf(error).map((r) => `[${r.code}] ${r.message}`));
			continue;
		}
		if (prepared.refusals.length) {
			refuse(prepared.refusals.map((r) => `[${r.code}] ${r.message}`));
			continue;
		}
		if (prepared.plan.video.sha256 !== seen.hashes[now.render.path]) {
			refuse([`The uploader would send ${prepared.plan.video.rel}, which is not the file shown on the page.`]);
			continue;
		}
		// every file the upload sends must be one the page showed, byte for byte (the spec and its files included)
		const shown: Record<string, string | null> = {...seen.hashes, ...(seen.specHashes ?? {})};
		const unseen = sentFiles(prepared).filter((f) => !f.sha256 || shown[f.rel] !== f.sha256);
		if (unseen.length) {
			refuse([`The uploader would send ${unseen.map((f) => f.rel).join(', ')}, which the page did not show as is. Rebuild the page (review) and look again.`]);
			continue;
		}
		const record = uploader.createApproval(prepared.plan, {
			nowMs: o.nowMs,
			approvedBy: o.by,
			validDays: Math.min(o.validDays, channels.approvalMaxDays),
			spec: prepared.inputs.spec?.rel ?? null,
			note: `Weekly batch ${o.week}, item ${item.id}, approved ${o.reply !== null ? 'by the owner\'s reply' : 'at a terminal'} on the weekly page #${current} (review ${snapshot.builtAt}).`,
		});
		const finalPath = join(o.root, item.paths.kitDir, `approval-${item.renderId}.json`);
		const tmpPath = `${finalPath}.${process.pid}.check`;
		writeJsonAtomic(tmpPath, record);
		try {
			const check = await uploader.prepareFromApproval({...common, approvalPath: tmpPath});
			if (check.refusals.length) {
				refuse(check.refusals.map((r) => `uploader check: [${r.code}] ${r.message}`));
				continue;
			}
		} catch (error) {
			refuse(reasonsOf(error).map((r) => `uploader check: [${r.code}] ${r.message}`));
			continue;
		} finally {
			if (refused.some((r) => r.id === item.id)) rmSync(tmpPath, {force: true});
		}
		renameSync(tmpPath, finalPath);
		const approvalRel = relative(o.root, finalPath).split('\\').join('/');
		const dubChanged = changedPaths(seen.dubHashes ?? {}, now.dubHashes);
		const dubTracks = (seen.dubsReady ?? []).filter((lang) => !dubChanged.some((p) => p.includes(`.${lang}.json`)));
		const notes = dubChanged.length ? [`Dub files changed after the page was built (${dubChanged.join(', ')}): do not add those tracks until a new page is reviewed.`] : [];
		for (const n of notes) o.log(`note ${item.id}: ${n}`);
		approved.push({
			id: item.id,
			channel: item.channel,
			slug: item.slug,
			renderId: item.renderId,
			kit: item.paths.kit,
			approval: approvalRel,
			approvalSha256: sha256(readFileSync(finalPath)),
			publishAt: item.slot.publishAt,
			publishAtLocal: formatLocal(Date.parse(item.slot.publishAt), plan.timeZone),
			title: prepared.plan.insert.body.snippet.title,
			quotaUnits: prepared.plan.quota.defaultUnits,
			dubTracks,
			notes,
			uploadCommand: uploadCommand(o.root, o.hubDir, item.paths.kit, approvalRel),
		});
		o.log(`approved ${item.id}: ${approvalRel} (private, publishes ${item.slot.local})`);
	}

	// the week's index of approvals (earlier runs' entries for other items are kept)
	const indexPath = join(approvalDir(o.root, o.week), 'approvals.json');
	const prior = readJson<{items?: ApprovedItem[]}>(indexPath);
	const kept = prior.ok && isRecord(prior.data) && Array.isArray(prior.data.items) ? (prior.data.items as ApprovedItem[]).filter((p) => !approved.some((a) => a.id === p.id) && !refused.some((r) => r.id === p.id)) : [];
	writeJsonAtomic(indexPath, {
		version: 1,
		kind: 'zoora-weekly-approvals',
		week: o.week,
		updatedAt: new Date(o.nowMs).toISOString(),
		review: {builtAt: snapshot.builtAt, page: snapshot.page.path, sha256: snapshot.page.sha256, code: current},
		...(o.reply !== null ? {reply: o.reply.trim()} : {via: 'terminal'}),
		note: 'Approval records for the creator-hub uploader. Nothing has been uploaded: the owner runs each uploadCommand from projects/creator-hub.',
		items: [...kept, ...approved].sort((a, b) => a.publishAt.localeCompare(b.publishAt) || a.id.localeCompare(b.id)),
		refused,
	});
	if (approved.length) {
		o.log('Nothing was uploaded. To upload, from projects/creator-hub (each one goes up private, scheduled for its slot):');
		for (const a of approved) o.log(`  ${a.uploadCommand}`);
	}
	o.log(`Index: ${relative(o.root, indexPath)}`);
	return {exitCode: refused.length ? (approved.length ? 1 : 3) : 0, approved, refused, indexPath};
};
