/**
 * The owner's approval record (approval.json): the only thing that lets the uploader send a video.
 *
 * It binds the exact upload: the rendered file's SHA-256 and size, the storyboard's version and SHA-256, and the
 * digest of everything that will be sent (video resource, thumbnail, caption files, playlist). Change any of them
 * after approval, or let the record expire, and plan/upload refuse until the owner approves again.
 *
 * Who writes it: the owner, with "cli.ts approve" (it shows the full plan first and asks the owner to type the
 * episode slug), or the daily pipeline's approve step after the owner taps Approve. A tool or agent must never write
 * one on the owner's behalf. It is a plain file, not a signature: it guards against wrong, stale or changed files,
 * not against someone who can already write to this machine.
 */
import {DIGEST_PARTS, type DigestPart, type UploadPlan} from './plan.ts';
import {formatInZone, parseIsoWithZone, toUtcIso} from './time.ts';
import {isRecord, num, type Reason, str} from './util.ts';

export const APPROVAL_KIND = 'youtube-upload-approval';

export type ApprovalRecord = {
	version: 1;
	kind: typeof APPROVAL_KIND;
	channel: string;
	slug: string;
	/** A role label such as "owner". Never a private person's name. */
	approvedBy: string;
	approvedAt: string;
	expiresAt: string;
	/** UTC ISO 8601; null keeps the video private until the owner publishes it in Studio. */
	publishAt: string | null;
	render: {id: string; path: string; sha256: string; bytes: number};
	storyboard: {path: string; version: number; sha256: string};
	plan: {sha256: string; parts: Record<DigestPart, string>};
	/** The choices the plan was built with, so plan and upload rebuild the same requests. Paths are relative to projects/video-studio. */
	inputs: {thumbnail: string | null; spec: string | null};
	/** What the owner saw, for people reading the file. Never used for verification. */
	summary: {
		title: string;
		privacyStatus: 'private';
		publishAtLocal: string | null;
		selfDeclaredMadeForKids: boolean;
		containsSyntheticMedia: boolean;
		paidPromotion: boolean;
		captions: string[];
		playlistId: string | null;
		quotaUnits: number;
	};
	note?: string;
};

const HEX64 = /^[0-9a-f]{64}$/;
const DAY_MS = 86_400_000;
/** Clock skew tolerated between the approving device and the uploading machine. */
const SKEW_MS = 5 * 60_000;

export type CreateApprovalOptions = {nowMs: number; approvedBy: string; validDays: number; spec: string | null; note?: string};

export const createApproval = (plan: UploadPlan, opts: CreateApprovalOptions): ApprovalRecord => ({
	version: 1,
	kind: APPROVAL_KIND,
	channel: plan.channel,
	slug: plan.slug,
	approvedBy: opts.approvedBy,
	approvedAt: toUtcIso(opts.nowMs),
	expiresAt: toUtcIso(opts.nowMs + opts.validDays * DAY_MS),
	publishAt: plan.publishAt,
	render: {id: plan.renderId, path: plan.video.rel, sha256: plan.video.sha256, bytes: plan.video.bytes},
	storyboard: {path: plan.storyboard.rel, version: plan.storyboard.version, sha256: plan.storyboard.sha256},
	plan: {sha256: plan.digest.sha256, parts: {...plan.digest.parts}},
	inputs: {thumbnail: plan.thumbnail?.rel ?? null, spec: opts.spec},
	summary: {
		title: plan.insert.body.snippet.title,
		privacyStatus: 'private',
		publishAtLocal: plan.publishAt ? formatInZone(Date.parse(plan.publishAt)) : null,
		selfDeclaredMadeForKids: plan.insert.body.status.selfDeclaredMadeForKids,
		containsSyntheticMedia: plan.insert.body.status.containsSyntheticMedia,
		paidPromotion: plan.paidPromotion,
		captions: plan.captions.map((c) => `${c.language} "${c.name}"`),
		playlistId: plan.playlistId,
		quotaUnits: plan.quota.defaultUnits,
	},
	...(opts.note ? {note: opts.note} : {}),
});

export type ParsedApproval = {ok: true; record: ApprovalRecord} | {ok: false; reasons: Reason[]};

/** Strict shape check. Anything unexpected is a refusal: an approval must be unambiguous. */
export const parseApproval = (data: unknown, source: string): ParsedApproval => {
	const problems: string[] = [];
	if (!isRecord(data)) return {ok: false, reasons: [{code: 'approval-invalid', message: `${source} is not an approval record (a JSON object).`}]};
	if (data.version !== 1 || data.kind !== APPROVAL_KIND) problems.push(`"version": 1 and "kind": "${APPROVAL_KIND}"`);
	for (const key of ['channel', 'slug', 'approvedBy'] as const) if (!str(data[key])) problems.push(`"${key}"`);
	for (const key of ['approvedAt', 'expiresAt'] as const) if (!str(data[key]) || parseIsoWithZone(String(data[key])) === null) problems.push(`"${key}" (ISO 8601 with Z or an offset)`);
	if (!(data.publishAt === null || (typeof data.publishAt === 'string' && parseIsoWithZone(data.publishAt) !== null))) problems.push('"publishAt" (null or ISO 8601 with Z or an offset)');
	const render = isRecord(data.render) ? data.render : null;
	if (!render || !str(render.id) || !str(render.path) || !HEX64.test(String(render.sha256)) || num(render.bytes) === null) problems.push('"render" {id, path, sha256, bytes}');
	const storyboard = isRecord(data.storyboard) ? data.storyboard : null;
	if (!storyboard || !str(storyboard.path) || num(storyboard.version) === null || !HEX64.test(String(storyboard.sha256))) problems.push('"storyboard" {path, version, sha256}');
	const plan = isRecord(data.plan) ? data.plan : null;
	const parts = plan && isRecord(plan.parts) ? plan.parts : null;
	if (!plan || !HEX64.test(String(plan.sha256)) || !parts || !DIGEST_PARTS.every((p) => HEX64.test(String(parts[p])))) problems.push(`"plan" {sha256, parts: ${DIGEST_PARTS.join(', ')}}`);
	const inputs = isRecord(data.inputs) ? data.inputs : null;
	if (!inputs || !(inputs.thumbnail === null || typeof inputs.thumbnail === 'string') || !(inputs.spec === null || typeof inputs.spec === 'string')) problems.push('"inputs" {thumbnail, spec}');
	if (problems.length) return {ok: false, reasons: [{code: 'approval-invalid', message: `${source} is not a valid approval record. Missing or malformed: ${problems.join('; ')}.`}]};
	return {ok: true, record: data as ApprovalRecord};
};

export type VerifyOptions = {nowMs: number; minLeadMinutes: number; maxDays: number};

/** Every reason the plan may not be sent under this approval (empty = approved). */
export const verifyApproval = (record: ApprovalRecord, plan: UploadPlan, opts: VerifyOptions): Reason[] => {
	const reasons: Reason[] = [];
	const add = (code: string, message: string) => reasons.push({code, message});
	const reapprove = 'Review it and approve again (cli.ts approve).';

	if (record.channel !== plan.channel || record.slug !== plan.slug) add('approval-wrong-episode', `The approval is for ${record.channel}/${record.slug}, but kit.json is ${plan.channel}/${plan.slug}.`);
	if (record.render.id !== plan.renderId) add('approval-wrong-render', `The approval is for render "${record.render.id}", not "${plan.renderId}".`);
	if (record.render.sha256 !== plan.video.sha256 || record.render.bytes !== plan.video.bytes) {
		add('render-hash-mismatch', `The rendered file changed after approval: approved sha256 ${record.render.sha256} (${record.render.bytes} bytes), now ${plan.video.sha256} (${plan.video.bytes} bytes) for ${plan.video.rel}. ${reapprove}`);
	}
	if (record.storyboard.version !== plan.storyboard.version) {
		add('storyboard-version-mismatch', `The approval was for storyboard version ${record.storyboard.version}; ${plan.storyboard.rel} is version ${plan.storyboard.version}. ${reapprove}`);
	} else if (record.storyboard.sha256 !== plan.storyboard.sha256) {
		add('storyboard-changed', `The storyboard changed after approval (${plan.storyboard.rel}: approved sha256 ${record.storyboard.sha256}, now ${plan.storyboard.sha256}). The render may no longer match it. ${reapprove}`);
	}
	if (record.plan.sha256 !== plan.digest.sha256) {
		const labels: Record<string, string> = {insert: 'title, description, tags, category, languages, localizations, publish time or settings', thumbnail: 'thumbnail', captions: 'captions', playlist: 'playlist'};
		const changed = (['insert', 'thumbnail', 'captions', 'playlist'] as const).filter((p) => record.plan.parts[p] !== plan.digest.parts[p]).map((p) => labels[p]);
		if (changed.length) add('metadata-changed', `What would be sent changed after approval: ${changed.join('; ')}. ${reapprove}`);
		else if (!reasons.length) add('metadata-changed', `The upload plan changed after approval (digest ${record.plan.sha256} vs ${plan.digest.sha256}). ${reapprove}`);
	}

	const approvedAt = parseIsoWithZone(record.approvedAt) ?? Number.NaN;
	const expiresAt = parseIsoWithZone(record.expiresAt) ?? Number.NaN;
	if (approvedAt > opts.nowMs + SKEW_MS) add('approval-from-future', `The approval is dated ${record.approvedAt}, in the future. Check the clocks of both machines.`);
	if (expiresAt - approvedAt > opts.maxDays * DAY_MS) add('approval-too-long', `The approval is valid for more than ${opts.maxDays} days (approvalMaxDays in channels.json). ${reapprove}`);
	if (!(expiresAt > opts.nowMs)) add('approval-expired', `The approval expired at ${record.expiresAt}. ${reapprove}`);

	if (record.publishAt !== null) {
		const publishAt = parseIsoWithZone(record.publishAt) ?? Number.NaN;
		const lead = opts.minLeadMinutes * 60_000;
		if (!(publishAt >= opts.nowMs + lead)) {
			add(
				'publish-time-too-soon',
				`publishAt ${record.publishAt} (${formatInZone(publishAt)}) is less than ${opts.minLeadMinutes} minutes away${publishAt <= opts.nowMs ? ' (it is in the past)' : ''}. YouTube publishes a past publishAt immediately, so the upload is refused. Approve a later time, or none to keep it private.`,
			);
		}
	}
	return reasons;
};
