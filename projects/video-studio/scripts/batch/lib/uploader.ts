/**
 * Thin adapter to the creator-hub uploader (creator-hub/tools/uploader, another workflow's finished tool). Its
 * README says a pipeline approve step must build the approval record with the uploader's own createApproval(), so
 * the plan digest is computed by the same code that later verifies it. This adapter loads exactly the modules that
 * build and check approvals (inputs, prepare, approval), never the ones that talk to YouTube (api, apply, oauth), so
 * the batch cannot upload anything through it. Loaded at run time from the hub folder, so video-studio's type check
 * does not depend on creator-hub's compiler settings; the shapes used here are checked at run time.
 */
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isRecord, UsageError} from './util.ts';

export type Reason = {code: string; message: string};

/** The parts of the uploader's UploadPlan the batch reads. */
export type UploaderPlan = {
	channel: string;
	slug: string;
	renderId: string;
	publishAt: string | null;
	video: {rel: string; sha256: string; bytes: number};
	storyboard: {rel: string; version: number; sha256: string};
	digest: {sha256: string};
	insert: {body: {snippet: {title: string}; status: {privacyStatus: string; publishAt?: string; selfDeclaredMadeForKids: boolean; containsSyntheticMedia: boolean}}};
	quota: {defaultUnits: number};
	studioSteps: string[];
	warnings: string[];
};

/** A file the upload reads: path relative to projects/video-studio (absolute when outside it) and its SHA-256. */
export type SentFile = {rel: string; sha256: string | null};

export type UploaderPrepared = {
	plan: UploaderPlan;
	inputs: {
		spec: {rel: string; sha256?: string} | null;
		thumbnail?: {rel: string; sha256: string} | null;
		/** rel is null for the kit's own captions (they are inside kit.json, which the page hashes). */
		captions?: Array<{rel: string | null; sha256: string}>;
		warnings: string[];
	};
	refusals: Reason[];
};

/**
 * Every file the upload would read: the video, the storyboard, the thumbnail, caption files and the spec. Read
 * defensively (the uploader is another workflow's tool): a missing hash comes back null, which the caller refuses.
 */
export const sentFiles = (p: UploaderPrepared): SentFile[] => {
	const hash = (x: unknown): string | null => (typeof x === 'string' && /^[0-9a-f]{64}$/.test(x) ? x : null);
	const out: SentFile[] = [
		{rel: p.plan.video.rel, sha256: hash(p.plan.video.sha256)},
		{rel: p.plan.storyboard.rel, sha256: hash(p.plan.storyboard.sha256)},
	];
	const i = p.inputs as Record<string, unknown>;
	if (isRecord(i.thumbnail) && typeof i.thumbnail.rel === 'string') out.push({rel: i.thumbnail.rel, sha256: hash(i.thumbnail.sha256)});
	if (Array.isArray(i.captions)) for (const c of i.captions) if (isRecord(c) && typeof c.rel === 'string') out.push({rel: c.rel, sha256: hash(c.sha256)});
	if (isRecord(i.spec) && typeof i.spec.rel === 'string') out.push({rel: i.spec.rel, sha256: hash(i.spec.sha256)});
	return out;
};

export type ChannelsConfig = {minLeadMinutes: number; approvalMaxDays: number; channels: Record<string, {categoryId: string | null}>};

export type PrepareCommon = {kitPath: string; videoStudioRoot: string; channels: ChannelsConfig; stateDir: string; nowMs: number; processingPolls: number; allowSecondUpload: boolean};

export type Uploader = {
	dir: string;
	defaultChannelsFile: string;
	loadChannels: (path: string) => ChannelsConfig;
	prepareForApproval: (o: PrepareCommon & {renderId: string; publishAt: string | null; spec?: string | null}) => Promise<UploaderPrepared>;
	prepareFromApproval: (o: PrepareCommon & {approvalPath: string}) => Promise<UploaderPrepared>;
	createApproval: (plan: UploaderPlan, o: {nowMs: number; approvedBy: string; validDays: number; spec: string | null; note?: string}) => Record<string, unknown>;
	parseApproval: (data: unknown, source: string) => {ok: true; record: Record<string, unknown>} | {ok: false; reasons: Reason[]};
};

const fn = (mod: unknown, name: string, file: string): ((...args: never[]) => unknown) => {
	const f = isRecord(mod) ? mod[name] : undefined;
	if (typeof f !== 'function') throw new UsageError(`The uploader's ${file} has no ${name}(): the batch's adapter (scripts/batch/lib/uploader.ts) needs updating to its current API.`);
	return f as (...args: never[]) => unknown;
};

/** Loads the uploader from <hubDir>/tools/uploader. A missing uploader is a usage error that says where it looked. */
export const loadUploader = async (hubDir: string): Promise<Uploader> => {
	const dir = join(hubDir, 'tools', 'uploader');
	const files = ['inputs.ts', 'prepare.ts', 'approval.ts'];
	const missing = files.filter((f) => !existsSync(join(dir, f)));
	if (missing.length) throw new UsageError(`The creator-hub uploader is not at ${dir} (missing ${missing.join(', ')}). Pass --hub <creator-hub folder>.`);
	const [inputs, prepare, approval] = await Promise.all(files.map((f) => import(pathToFileURL(join(dir, f)).href) as Promise<unknown>));
	const defaultChannelsFile = isRecord(inputs) && typeof inputs.DEFAULT_CHANNELS_FILE === 'string' ? inputs.DEFAULT_CHANNELS_FILE : join(dir, 'channels.json');
	return {
		dir,
		defaultChannelsFile,
		loadChannels: fn(inputs, 'loadChannels', 'inputs.ts') as Uploader['loadChannels'],
		prepareForApproval: fn(prepare, 'prepareForApproval', 'prepare.ts') as Uploader['prepareForApproval'],
		prepareFromApproval: fn(prepare, 'prepareFromApproval', 'prepare.ts') as Uploader['prepareFromApproval'],
		createApproval: fn(approval, 'createApproval', 'approval.ts') as Uploader['createApproval'],
		parseApproval: fn(approval, 'parseApproval', 'approval.ts') as Uploader['parseApproval'],
	};
};

/** The uploader's own errors carry `reasons: [{code, message}]`; anything else becomes one reason. */
export const reasonsOf = (error: unknown): Reason[] => {
	if (isRecord(error) && Array.isArray(error.reasons)) {
		const list = error.reasons.filter(isRecord).map((r) => ({code: String(r.code ?? 'error'), message: String(r.message ?? '')}));
		if (list.length) return list;
	}
	if (error instanceof UsageError) return error.reasons.map((message) => ({code: 'usage', message}));
	return [{code: 'error', message: error instanceof Error ? error.message : String(error)}];
};
