/**
 * The owner's approval, checked before anything goes out to the public or to subscribers: an announcement posted
 * with --apply, or a daily Threat Brief Kit draft. Owner rules (video-studio CLAUDE.md "Channel 2", and
 * docs/PROJECT_INSTRUCTIONS.md): the owner reviews and approves every video, and nothing is published unless he asks.
 *
 * Two records can approve an episode. Paths inside both are relative to projects/video-studio (`studioRoot`).
 * - The daily pipeline's content approval (video-studio scripts/daily/lib/approve.ts): schema
 *   "zoora-security/approval@1", kind "daily-content-approval", at content/zoora-security/<slug>/approval.json.
 *   It binds the storyboard, brief, render, news-gate report, publish kit and packet by SHA-256, and
 *   versionHash = sha256("storyboard:<sha>\nrender:<sha>\n"). The YouTube id is recorded on it after the manual upload.
 * - The uploader's upload approval (creator-hub tools/uploader/approval.ts): kind "youtube-upload-approval". It
 *   binds the storyboard and the render by SHA-256 and expires. It does not bind kit.json.
 *
 * This checks what can be checked from here: the record's own consistency, that it is for this episode, that the
 * storyboard it approved is unchanged, that a daily kit.json is byte for byte the approved one, and that the video id
 * is the one recorded. A record is a plain file, not a signature: it guards against wrong, stale or changed files,
 * not against someone who can already write to this machine.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

export const DAILY_APPROVAL_SCHEMA = 'zoora-security/approval@1';
export const DAILY_APPROVAL_KIND = 'daily-content-approval';
export const UPLOAD_APPROVAL_KIND = 'youtube-upload-approval';
export type ApprovalKind = typeof DAILY_APPROVAL_KIND | typeof UPLOAD_APPROVAL_KIND;

/** Clock skew tolerated between the approving device and this machine. */
const SKEW_MS = 5 * 60_000;
const HEX64 = /^[0-9a-f]{64}$/;

export type ApprovalExpect = {
	channel: string;
	slug: string;
	/** The daily PostInput's title, which the daily approval records (approval.title). */
	title?: string;
	/** True when the post or email is labelled DEVELOPING. A developing approval needs the label. */
	developing?: boolean;
	/** The video the post links to: it must be the one the approval recorded (daily records). */
	youtubeVideoId?: string | null;
	/** The kit.json being announced: for a daily record it must be the approved publish kit, byte for byte. */
	kitFile?: string | null;
	/** Only this kind of record approves the action (the daily Threat Brief needs the daily content approval). */
	requireKind?: ApprovalKind;
};

export type ApprovalCheck = {
	ok: boolean;
	file: string;
	kind: ApprovalKind | null;
	/** Why the record does not approve this; empty when ok. */
	reasons: string[];
	/** What was checked, for the report. */
	checked: string[];
	/** The approved version: the daily versionHash, or the upload plan's digest. */
	versionHash: string | null;
	/** The video id recorded on a daily approval (after the manual upload), or null. */
	youtubeVideoId: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const norm = (value: string): string => value.replace(/\s+/g, ' ').trim();
export const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

const fileSha = (path: string): string | null => {
	try {
		return sha256Hex(readFileSync(path));
	} catch {
		return null;
	}
};

const isoMs = (value: unknown): number | null => {
	const text = str(value);
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return null;
	const ms = Date.parse(text);
	return Number.isFinite(ms) ? ms : null;
};

/** The daily record's own version hash, as video-studio's approve step computes it. */
export const dailyVersionHash = (storyboardSha: string, renderSha: string): string => sha256Hex(`storyboard:${storyboardSha}\nrender:${renderSha}\n`);

/** The default place of an episode's daily content approval. */
export const dailyApprovalPath = (studioRoot: string, channel: string, slug: string): string => resolve(studioRoot, 'content', channel, slug, 'approval.json');

/** Checks that `rel` (relative to studioRoot) still hashes to `sha`. */
const unchanged = (studioRoot: string, label: string, rel: unknown, sha: unknown, reasons: string[], checked: string[]): void => {
	const path = str(rel);
	const want = str(sha);
	if (!path || !HEX64.test(want)) {
		reasons.push(`the approval records no ${label} hash`);
		return;
	}
	const got = fileSha(resolve(studioRoot, path));
	if (got === null) reasons.push(`the approved ${label} is missing (${path}); was it moved? Approve the current version again`);
	else if (got !== want) reasons.push(`the ${label} changed after approval (${path}): approve the new version first`);
	else checked.push(`the ${label} is the approved version (${path})`);
};

const checkDaily = (raw: Record<string, unknown>, expect: ApprovalExpect, studioRoot: string, nowMs: number, out: ApprovalCheck): void => {
	const {reasons, checked} = out;
	if (raw.version !== 1 || raw.schema !== DAILY_APPROVAL_SCHEMA) reasons.push(`it is not a daily approval record ("schema": "${DAILY_APPROVAL_SCHEMA}", "version": 1)`);
	if (raw.decision !== 'approved') reasons.push(`its decision is ${JSON.stringify(raw.decision ?? null)}, not "approved"`);
	if (str(raw.channel) !== expect.channel || str(raw.slug) !== expect.slug) reasons.push(`it approves ${str(raw.channel) || '?'}/${str(raw.slug) || '?'}, not ${expect.channel}/${expect.slug}`);
	const approvedAt = isoMs(raw.approvedAt);
	if (approvedAt === null) reasons.push('its "approvedAt" is not an ISO 8601 time');
	else if (approvedAt > nowMs + SKEW_MS) reasons.push(`it is dated ${str(raw.approvedAt)}, in the future: check the clocks`);
	const versions = isRecord(raw.versions) ? raw.versions : {};
	const sb = isRecord(versions.storyboard) ? versions.storyboard : {};
	const render = isRecord(versions.render) ? versions.render : {};
	const sbSha = str(sb.sha256);
	const renderSha = str(render.sha256);
	const vh = str(raw.versionHash);
	if (!HEX64.test(vh) || !HEX64.test(sbSha) || !HEX64.test(renderSha) || dailyVersionHash(sbSha, renderSha) !== vh) {
		reasons.push('its versionHash does not match the storyboard and render hashes it records (edited by hand?)');
	} else {
		out.versionHash = vh;
		checked.push(`version ${vh.slice(0, 12)} (storyboard and render hashes)`);
	}
	unchanged(studioRoot, 'storyboard', sb.path, sb.sha256, reasons, checked);
	if (expect.title !== undefined && norm(str(raw.title)) !== norm(expect.title)) reasons.push(`it approves the title "${str(raw.title)}", not "${expect.title}"`);
	if (raw.developing === true && expect.developing === false) reasons.push('it approves a DEVELOPING story, but this is not labelled DEVELOPING');
	const upload = isRecord(raw.upload) ? raw.upload : {};
	const recorded = /^[A-Za-z0-9_-]{11}$/.test(str(upload.youtubeVideoId)) ? str(upload.youtubeVideoId) : null;
	out.youtubeVideoId = recorded;
	if (expect.youtubeVideoId !== undefined) {
		if (!recorded) reasons.push(`it records no YouTube id yet: after the manual upload, record it (node scripts/daily/run.ts approve ${expect.slug} --youtube-id <id>)`);
		else if (expect.youtubeVideoId !== recorded) reasons.push(`it records the video ${recorded}, not ${expect.youtubeVideoId ?? 'none'}: announce the approved video`);
		else checked.push(`the video is the recorded upload (${recorded})`);
	}
	if (expect.kitFile) {
		const kit = isRecord(versions.publishKit) ? versions.publishKit : {};
		const want = str(kit.sha256);
		const got = fileSha(expect.kitFile);
		if (!HEX64.test(want)) reasons.push('it records no publish kit, so no kit.json is approved for posting');
		else if (got !== want) reasons.push(`kit.json is not the approved publish kit (sha256 ${got?.slice(0, 12) ?? 'unreadable'}, approved ${want.slice(0, 12)}): rebuild and approve again`);
		else checked.push(`kit.json is the approved publish kit (${want.slice(0, 12)})`);
	}
};

const checkUpload = (raw: Record<string, unknown>, expect: ApprovalExpect, studioRoot: string, nowMs: number, out: ApprovalCheck): void => {
	const {reasons, checked} = out;
	if (raw.version !== 1) reasons.push('it is not a version 1 upload approval');
	if (str(raw.channel) !== expect.channel || str(raw.slug) !== expect.slug) reasons.push(`it approves ${str(raw.channel) || '?'}/${str(raw.slug) || '?'}, not ${expect.channel}/${expect.slug}`);
	const approvedAt = isoMs(raw.approvedAt);
	const expiresAt = isoMs(raw.expiresAt);
	if (approvedAt === null || expiresAt === null) reasons.push('its "approvedAt" or "expiresAt" is not an ISO 8601 time');
	else {
		if (approvedAt > nowMs + SKEW_MS) reasons.push(`it is dated ${str(raw.approvedAt)}, in the future: check the clocks`);
		if (!(expiresAt > nowMs)) reasons.push(`it expired at ${str(raw.expiresAt)}`);
	}
	const sb = isRecord(raw.storyboard) ? raw.storyboard : {};
	unchanged(studioRoot, 'storyboard', sb.path, sb.sha256, reasons, checked);
	const plan = isRecord(raw.plan) ? raw.plan : {};
	if (HEX64.test(str(plan.sha256))) out.versionHash = str(plan.sha256);
	else reasons.push('it records no upload plan digest');
	if (expect.kitFile) checked.push('an upload approval does not bind kit.json: check the posts in the dry run');
};

/** Reads and checks an approval record. Fails closed: anything unexpected is a reason. */
export const checkApproval = (file: string, expect: ApprovalExpect, opts: {studioRoot: string; now: Date}): ApprovalCheck => {
	const out: ApprovalCheck = {ok: false, file, kind: null, reasons: [], checked: [], versionHash: null, youtubeVideoId: null};
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(file, 'utf8'));
	} catch (err) {
		out.reasons.push((err as NodeJS.ErrnoException).code === 'ENOENT' ? `no approval record at ${file}` : `cannot read the approval record ${file}: ${(err as Error).message}`);
		return out;
	}
	if (!isRecord(raw)) {
		out.reasons.push(`${file} is not an approval record (a JSON object)`);
		return out;
	}
	const kind = raw.kind === DAILY_APPROVAL_KIND || raw.kind === UPLOAD_APPROVAL_KIND ? raw.kind : null;
	out.kind = kind;
	if (!kind) out.reasons.push(`${file} has an unknown "kind" ${JSON.stringify(raw.kind ?? null)} (expected "${DAILY_APPROVAL_KIND}" or "${UPLOAD_APPROVAL_KIND}")`);
	else if (expect.requireKind && kind !== expect.requireKind) out.reasons.push(`this needs the owner's "${expect.requireKind}" record, not "${kind}"`);
	else if (kind === DAILY_APPROVAL_KIND) checkDaily(raw, expect, opts.studioRoot, opts.now.getTime(), out);
	else checkUpload(raw, expect, opts.studioRoot, opts.now.getTime(), out);
	out.ok = out.reasons.length === 0;
	return out;
};

/** One line for a report. */
export const approvalLine = (check: ApprovalCheck | null): string =>
	!check ? 'approval: not checked' : check.ok ? `approval: ${check.kind} ${check.versionHash?.slice(0, 12) ?? ''} OK (${check.checked.join('; ')})` : `approval: NOT APPROVED: ${check.reasons.join('; ')}`;
