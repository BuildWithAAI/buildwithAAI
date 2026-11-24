/**
 * Builds the plan the same way for every command:
 * - forApproval (approve): from the owner's choices, before any approval exists.
 * - fromApproval (plan, upload): from the approval record's own recorded choices, then checks the record against
 *   the files as they are now. Any reason in `refusals` means nothing may be sent.
 */
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {type ApprovalRecord, paidScheduleReason, parseApproval, verifyApproval} from './approval.ts';
import {type ChannelsConfig, gatherInputs, type UploadInputs} from './inputs.ts';
import {ledgerRefusals, openLedger} from './ledger.ts';
import {buildPlan, type UploadPlan} from './plan.ts';
import {jobPath, loadJob} from './state.ts';
import {type Reason, sha256Hex, UsageError} from './util.ts';

export type Prepared = {
	inputs: UploadInputs;
	plan: UploadPlan;
	approval: ApprovalRecord | null;
	approvalSha256: string | null;
	refusals: Reason[];
	/** This exact plan's video is already on YouTube (its job says so): only follow-up steps remain. */
	uploaded: boolean;
};

export type CommonPrepareOptions = {
	kitPath: string;
	videoStudioRoot: string | null;
	channels: ChannelsConfig;
	stateDir: string;
	nowMs: number;
	processingPolls: number;
	allowSecondUpload: boolean;
	/** Override for the rendered file (e.g. a render-farm download); the approval's hash still has to match. */
	video?: string | null;
};

const ledgerReasons = (stateDir: string, plan: UploadPlan, allowSecondUpload: boolean): Reason[] => {
	const path = join(stateDir, 'ledger.json');
	return existsSync(path) ? ledgerRefusals(openLedger(path), plan, {allowSecondUpload}) : [];
};

export type ForApprovalOptions = CommonPrepareOptions & {renderId: string; thumbnail?: string | null; spec?: string | null; storyboard?: string | null; publishAt: string | null};

/** For "approve": the plan from the owner's choices; refusals are what would stop the upload anyway. */
export const prepareForApproval = async (opts: ForApprovalOptions): Promise<Prepared> => {
	const inputs = await gatherInputs({
		kitPath: opts.kitPath,
		videoStudioRoot: opts.videoStudioRoot,
		channels: opts.channels,
		renderId: opts.renderId,
		video: opts.video,
		thumbnail: opts.thumbnail,
		spec: opts.spec,
		storyboard: opts.storyboard,
	});
	const plan = buildPlan(inputs, {publishAt: opts.publishAt, processingPolls: opts.processingPolls});
	const refusals: Reason[] = [...inputs.kitFailures, ...ledgerReasons(opts.stateDir, plan, opts.allowSecondUpload)];
	const paid = paidScheduleReason(plan);
	if (paid) refusals.push(paid);
	if (opts.publishAt) {
		const lead = opts.channels.minLeadMinutes * 60_000;
		if (Date.parse(opts.publishAt) < opts.nowMs + lead) {
			refusals.push({code: 'publish-time-too-soon', message: `The publish time must be at least ${opts.channels.minLeadMinutes} minutes from now (YouTube publishes a past publishAt immediately).`});
		}
	}
	return {inputs, plan, approval: null, approvalSha256: null, refusals, uploaded: false};
};

export type FromApprovalOptions = CommonPrepareOptions & {approvalPath: string};

/** A refusal that happens before any input can be read (no approval file, or a malformed one). */
export class EarlyRefusal extends Error {
	readonly reasons: Reason[];
	constructor(reasons: Reason[]) {
		super(reasons.map((r) => r.message).join('\n'));
		this.name = 'EarlyRefusal';
		this.reasons = reasons;
	}
}

/** For "plan" and "upload": rebuilds the plan from the approval record's own choices and verifies the record. */
export const prepareFromApproval = async (opts: FromApprovalOptions): Promise<Prepared> => {
	if (!existsSync(opts.approvalPath)) {
		throw new EarlyRefusal([{code: 'approval-missing', message: `No approval record at ${opts.approvalPath}. Nothing is sent without the owner's approval: run "cli.ts approve <kit.json>" to review the upload and approve it.`}]);
	}
	const bytes = readFileSync(opts.approvalPath);
	let data: unknown;
	try {
		data = JSON.parse(bytes.toString('utf8'));
	} catch {
		throw new EarlyRefusal([{code: 'approval-invalid', message: `${opts.approvalPath} is not valid JSON, so it is not an approval.`}]);
	}
	const parsed = parseApproval(data, opts.approvalPath);
	if (!parsed.ok) throw new EarlyRefusal(parsed.reasons);
	const record = parsed.record;
	let inputs: UploadInputs;
	try {
		inputs = await gatherInputs({
			kitPath: opts.kitPath,
			videoStudioRoot: opts.videoStudioRoot,
			channels: opts.channels,
			renderId: record.render.id,
			video: opts.video ?? record.render.path,
			thumbnail: record.inputs.thumbnail,
			spec: record.inputs.spec,
			storyboard: record.storyboard.path,
		});
	} catch (error) {
		// a file the approval names is gone or unreadable: still a refusal, with the reason
		if (error instanceof UsageError) throw new EarlyRefusal(error.reasons.map((r) => ({code: r.code === 'video-missing' ? 'render-missing' : r.code, message: r.message})));
		throw error;
	}
	const plan = buildPlan(inputs, {publishAt: record.publishAt ? new Date(Date.parse(record.publishAt)).toISOString() : null, processingPolls: opts.processingPolls});
	// Once this exact plan's video is on YouTube, finishing its remaining steps (thumbnail, captions, playlist) is not
	// held up by the schedule coming close or the approval ageing: both guard the upload itself, which already happened.
	const job = loadJob(jobPath(opts.stateDir, plan));
	const uploaded = job !== null && job.planSha256 === plan.digest.sha256 && job.insert.status === 'done';
	const refusals = [
		...verifyApproval(record, plan, {nowMs: opts.nowMs, minLeadMinutes: opts.channels.minLeadMinutes, maxDays: opts.channels.approvalMaxDays}).filter(
			(r) => !(uploaded && (r.code === 'publish-time-too-soon' || r.code === 'approval-expired')),
		),
		...inputs.kitFailures,
		...ledgerReasons(opts.stateDir, plan, opts.allowSecondUpload),
	];
	return {inputs, plan, approval: record, approvalSha256: sha256Hex(bytes), refusals, uploaded};
};
