/**
 * Planning: which request files a push changed, and the job matrices the workflow fans out
 * (.github/workflows/video-render.yml). Matrix cells carry only validated, non-content values (ids, indexes,
 * composition ids, languages): props never enter the matrix, so they never reach job names or logs.
 */
import {ID_RE, type Kind, type RenderRequest} from './request.ts';

export const REQUESTS_DIR = 'render-requests';

export const PLAN_LIMITS = {
	requestsPerRun: 16,
	renderJobsPerRun: 128, // GitHub's matrix limit is 256 jobs per workflow run
	voiceJobsPerRun: 48,
} as const;

export type RenderCell = {
	request: string;
	index: number;
	composition: string;
	kind: Kind;
	lang: string; // '-' when the job has no language
	encrypt: boolean;
	artifact: string;
	voicePattern: string; // download-artifact pattern for this job's narration ('' when none)
	voiceExpect: number; // how many voice artifacts that pattern must deliver
};

export type VoiceCell = {
	request: string;
	vindex: number;
	channel: string;
	slug: string;
	lang: string;
	encrypt: boolean;
	cjk: boolean; // zh needs the misaki G2P extras
	artifact: string;
};

export type Plan = {render: RenderCell[]; voice: VoiceCell[]};

// Artifact names use "_" as the separator: request ids cannot contain it, so the pattern voice_<id>_* never matches
// another request whose id merely starts with <id>-.
export const voiceArtifact = (request: string, vindex: number): string => `voice_${request}_${vindex}`;
export const renderArtifact = (request: string, index: number, composition: string, lang: string | null): string =>
	`render_${request}_${index}_${composition}${lang ? `_${lang}` : ''}`;
export const renderProbeArtifact = (request: string, index: number): string => `probe_render_${request}_${index}`;
export const voiceProbeArtifact = (request: string, vindex: number): string => `probe_voice_${request}_${vindex}`;

/**
 * The voice entries a render job needs. A job whose props name exactly one voice entry (same channel, slug and lang,
 * as Episode and EpisodeShort props do) gets only that narration; any other job gets all of the request's narration.
 */
export const voiceNeeds = (req: RenderRequest, index: number): number[] => {
	if (!req.voice.length) return [];
	const p = req.jobs[index].props;
	const exact = req.voice.flatMap((v, i) => (p.channel === v.channel && p.slug === v.slug && p.lang === v.lang ? [i] : []));
	return exact.length === 1 ? exact : req.voice.map((_, i) => i);
};

export const buildPlan = (requests: RenderRequest[]): {plan: Plan; errors: string[]} => {
	const errors: string[] = [];
	const render: RenderCell[] = [];
	const voice: VoiceCell[] = [];
	if (requests.length > PLAN_LIMITS.requestsPerRun) errors.push(`one push may change at most ${PLAN_LIMITS.requestsPerRun} request files (this one changed ${requests.length})`);
	for (const req of requests) {
		req.voice.forEach((v, vindex) => {
			voice.push({request: req.id, vindex, channel: v.channel, slug: v.slug, lang: v.lang, encrypt: req.encrypt, cjk: v.lang === 'zh', artifact: voiceArtifact(req.id, vindex)});
		});
		req.jobs.forEach((j, index) => {
			const needs = voiceNeeds(req, index);
			render.push({
				request: req.id,
				index,
				composition: j.composition,
				kind: j.kind,
				lang: j.lang ?? '-',
				encrypt: req.encrypt,
				artifact: renderArtifact(req.id, index, j.composition, j.lang),
				voicePattern: needs.length === 0 ? '' : needs.length === 1 ? voiceArtifact(req.id, needs[0]) : `voice_${req.id}_*`,
				voiceExpect: needs.length,
			});
		});
	}
	if (render.length > PLAN_LIMITS.renderJobsPerRun) errors.push(`one run may hold at most ${PLAN_LIMITS.renderJobsPerRun} render jobs (this one has ${render.length})`);
	if (voice.length > PLAN_LIMITS.voiceJobsPerRun) errors.push(`one run may hold at most ${PLAN_LIMITS.voiceJobsPerRun} voice jobs (this one has ${voice.length})`);
	return {plan: {render, voice}, errors};
};

/** Runs git with arguments (never through a shell). */
export type Git = (args: string[]) => {ok: boolean; stdout: string};

export type ChangeInput = {
	event: string; // github.event_name
	before: string; // github.event.before (push)
	head: string; // github.sha
	dispatchRequest: string; // workflow_dispatch input: a request id
	listRequestFiles: () => string[]; // file names directly in render-requests/
};

export type Changes = {ids: string[]; badNames: string[]; ignored: string[]; how: string; errors: string[]};

const SHA_RE = /^[0-9a-f]{40}$/;

/** Sorts changed paths (relative to the project, e.g. render-requests/x.json) into request ids, bad names and others. */
export const classifyPaths = (paths: string[]): Pick<Changes, 'ids' | 'badNames' | 'ignored'> => {
	const ids = new Set<string>();
	const badNames: string[] = [];
	const ignored: string[] = [];
	for (const p of paths) {
		const rest = p.startsWith(`${REQUESTS_DIR}/`) ? p.slice(REQUESTS_DIR.length + 1) : null;
		if (rest === null || rest.includes('/') || !rest.endsWith('.json')) {
			ignored.push(p);
			continue;
		}
		const id = rest.slice(0, -'.json'.length);
		if (ID_RE.test(id)) ids.add(id);
		else badNames.push(rest);
	}
	return {ids: [...ids].sort(), badNames: badNames.sort(), ignored: ignored.sort()};
};

const splitZ = (s: string): string[] => s.split('\0').filter(Boolean);

/**
 * The request files to render. A push renders the request files it added or modified (deleted ones are skipped);
 * workflow_dispatch renders the one request it names. Runs with the project folder as git's working directory.
 */
export const detectChanges = (input: ChangeInput, git: Git): Changes => {
	const errors: string[] = [];
	if (input.event === 'workflow_dispatch') {
		const id = input.dispatchRequest.trim().replace(/\.json$/, '');
		if (!ID_RE.test(id)) return {ids: [], badNames: [], ignored: [], how: 'workflow_dispatch', errors: ['the request input must be a request id: the file name in render-requests/ without .json']};
		if (!input.listRequestFiles().includes(`${id}.json`)) return {ids: [], badNames: [], ignored: [], how: 'workflow_dispatch', errors: [`${REQUESTS_DIR}/${id}.json does not exist on this branch`]};
		return {ids: [id], badNames: [], ignored: [], how: 'workflow_dispatch', errors};
	}
	if (input.event !== 'push') return {ids: [], badNames: [], ignored: [], how: input.event, errors: [`unsupported event "${input.event.replace(/[^a-z_]/g, '')}"`]};
	if (!SHA_RE.test(input.head)) return {ids: [], badNames: [], ignored: [], how: 'push', errors: ['the head commit sha is missing or malformed']};

	const diff = (from: string): string[] | null => {
		const r = git(['diff', '--no-renames', '--name-only', '--diff-filter=AM', '-z', '--relative', from, input.head, '--', REQUESTS_DIR]);
		return r.ok ? splitZ(r.stdout) : null;
	};
	const hasCommit = (sha: string) => git(['cat-file', '-e', `${sha}^{commit}`]).ok;

	let paths: string[] | null = null;
	let how = '';
	if (SHA_RE.test(input.before) && !/^0+$/.test(input.before)) {
		if (!hasCommit(input.before)) git(['fetch', '--no-tags', '--quiet', '--depth=1', 'origin', input.before]);
		if (hasCommit(input.before)) {
			paths = diff(input.before);
			how = 'files changed by this push';
		}
	}
	if (paths === null) {
		// A new branch (before = 000...0) or a base the remote no longer has (force push): use the head commit alone.
		if (git(['rev-parse', '--verify', '--quiet', `${input.head}^1`]).ok) {
			paths = diff(`${input.head}^1`);
			how = 'files changed by the head commit (new branch or unknown base)';
		} else {
			paths = input.listRequestFiles().map((f) => `${REQUESTS_DIR}/${f}`);
			how = 'every request file (root commit)';
		}
	}
	if (paths === null) return {ids: [], badNames: [], ignored: [], how, errors: ['git diff failed']};
	return {...classifyPaths(paths), how, errors};
};
