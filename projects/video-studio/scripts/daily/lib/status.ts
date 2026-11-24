/** status <date-slug>: where an episode stands (brief, storyboard, gate, packet, approval, upload), read-only. */
import {existsSync} from 'node:fs';
import {episodePaths} from './paths.ts';
import type {ApprovalRecord, DailyBrief, PacketSummary} from './types.ts';
import {isRecord, readJson, rel, sha256File} from './util.ts';

export type Status = {
	slug: string;
	stage: 'no-brief' | 'brief-ready' | 'storyboard-written' | 'packet-not-ready' | 'packet-ready' | 'packet-stale' | 'approved' | 'uploaded';
	lines: string[];
};

export const statusOf = (root: string, dateSlug: string): Status => {
	const ep = episodePaths(root, dateSlug);
	const lines: string[] = [`${dateSlug}`];
	const brief = readJson<DailyBrief>(ep.brief);
	if (!brief.ok) return {slug: dateSlug, stage: 'no-brief', lines: [...lines, `No brief: run prepare (expected ${rel(root, ep.brief)}).`]};
	lines.push(`Brief: ${rel(root, ep.brief)} (${isRecord(brief.data) ? `${brief.data.status}, incident ${brief.data.incident?.id}` : 'unreadable'})`);
	if (!existsSync(ep.storyboard)) return {slug: dateSlug, stage: 'brief-ready', lines: [...lines, `No storyboard yet: write ${rel(root, ep.storyboard)} following ${rel(root, ep.writer)}.`]};
	const sbSha = sha256File(ep.storyboard);
	lines.push(`Storyboard: ${rel(root, ep.storyboard)} (${sbSha?.slice(0, 12)})`);
	const pk = readJson<PacketSummary>(ep.packetJson);
	if (!pk.ok) return {slug: dateSlug, stage: 'storyboard-written', lines: [...lines, `No packet yet: run build ${dateSlug}.`]};
	const p = pk.data;
	const stale = p.versions.storyboard.sha256 !== sbSha;
	lines.push(`Packet: ${rel(root, ep.approvalHtml)} built ${p.builtAt}: ${p.readyToApprove ? 'READY' : 'NOT READY'}${stale ? ' (STALE: the storyboard changed since)' : ''}`);
	for (const s of p.steps) lines.push(`  ${s.title}: ${s.status}${s.blocking ? ' (blocks)' : ''}`);
	for (const b of p.blockers) lines.push(`  blocker: ${b}`);
	const ap = readJson<ApprovalRecord>(ep.approvalJson);
	if (ap.ok && isRecord(ap.data) && ap.data.schema === 'zoora-security/approval@1') {
		const a = ap.data;
		lines.push(`Approved by ${a.approvedBy} at ${a.approvedAtLocal} (version ${a.versionHash.slice(0, 12)})${a.versionHash && stale ? ' — the storyboard changed after approval: re-approve' : ''}`);
		for (const r of a.postApproval) lines.push(`  ${r.id}: ${r.mode}, ${r.status}`);
		lines.push(a.upload.youtubeVideoId ? `Uploaded by hand: https://youtu.be/${a.upload.youtubeVideoId}` : 'Not uploaded yet (manual in YouTube Studio).');
		return {slug: dateSlug, stage: a.upload.youtubeVideoId ? 'uploaded' : 'approved', lines};
	}
	return {slug: dateSlug, stage: stale ? 'packet-stale' : p.readyToApprove ? 'packet-ready' : 'packet-not-ready', lines};
};
