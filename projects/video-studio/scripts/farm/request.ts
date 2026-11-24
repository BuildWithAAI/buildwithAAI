/**
 * Render requests: the contract of projects/video-studio/render-requests/<id>.json (docs/RENDER_FARM.md).
 *
 * Validation is strict: unknown keys, wrong types and unsafe values are errors. The repository is public and request
 * values can be episode content, so error messages name the field and the rule, never the value.
 */

/** Remotion entry points a request may render from. src/show/index.ts is accepted once the show build lands. */
export const ENTRIES = ['src/index.ts', 'src/episode/index.ts', 'src/show/index.ts', 'src/charts/dev/index.ts'] as const;
export type Entry = (typeof ENTRIES)[number];

/**
 * Entries whose renders are tests (dev sheets, TestCard, chart demos): the only ones that may skip encryption.
 * Episode, show and thumbnail renders are unreleased work and are always encrypted.
 */
export const TEST_ENTRIES: readonly Entry[] = ['src/index.ts', 'src/charts/dev/index.ts'];

/** src/episode/types.ts `Lang`. Used to label jobs (props.lang); the composition validates its own props. */
export const LANGS = ['en', 'es', 'pt-br', 'hi', 'it', 'zh', 'ja'] as const;

/** Languages the voice step can voice for Zoo. Japanese is blocked until a real G2P works; French has no male voice. */
export const VOICE_LANGS = ['en', 'es', 'pt-br', 'hi', 'it', 'zh'] as const;
export type VoiceLang = (typeof VOICE_LANGS)[number];

/** Zoo's voice in every language (owner decision 2026-11-24, CLAUDE.md). */
export const ZOO_VOICE = 'im_nicola';

/** The farm's own voice self-test fixtures live in scripts/farm/fixtures/_farm/<slug> instead of content/. */
export const FARM_CHANNEL = '_farm';

export const LIMITS = {
	jobsPerRequest: 32,
	voicePerRequest: 12,
	propsBytes: 256 * 1024,
	requestBytes: 1024 * 1024,
	outputChars: 200,
	outputDepth: 10,
	maxFrame: 1_000_000,
	retentionMinDays: 1,
	retentionMaxDays: 90, // GitHub's maximum for public repositories
	retentionDefaultDays: 7,
} as const;

export type Kind = 'video' | 'still';

export type RenderJob = {
	composition: string;
	props: Record<string, unknown>;
	output: string; // under out/, relative to projects/video-studio
	kind: Kind;
	entry: Entry; // the job's own entry, or the request's
	frame: number; // stills only (0 for videos)
	lang: string | null; // props.lang when it is a known Lang (labels only)
};

export type VoiceEntry = {channel: string; slug: string; lang: VoiceLang; voice: typeof ZOO_VOICE};

export type RenderRequest = {
	id: string;
	entry: Entry;
	jobs: RenderJob[];
	voice: VoiceEntry[];
	encrypt: boolean;
	retentionDays: number;
};

export type Validation = {ok: true; request: RenderRequest} | {ok: false; errors: string[]};

export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const COMPOSITION_RE = /^[A-Za-z0-9-]{1,64}$/;
/** out/ plus one or more segments; a segment never starts with '.', so '.', '..' and hidden files are impossible. */
const OUTPUT_RE = /^out(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$/;
const CHANNEL_RE = /^_?[a-z0-9][a-z0-9-]{0,47}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,95}$/;
const KEY_NAME_RE = /^[A-Za-z0-9_-]{1,40}$/;
const EXTENSIONS: Record<Kind, readonly string[]> = {video: ['.mp4'], still: ['.png', '.jpg', '.jpeg']};

const TOP_KEYS = ['id', 'entry', 'jobs', 'voice', 'encrypt', 'retentionDays'];
const JOB_KEYS = ['composition', 'props', 'output', 'kind', 'entry', 'frame'];
const VOICE_KEYS = ['channel', 'slug', 'lang', 'voice'];

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

const isEntry = (v: unknown): v is Entry => typeof v === 'string' && (ENTRIES as readonly string[]).includes(v);
const isVoiceLang = (v: unknown): v is VoiceLang => typeof v === 'string' && (VOICE_LANGS as readonly string[]).includes(v);

/** Names an unknown key only when the name itself is plain (key names are structure, not content). */
const unknownKeys = (obj: Record<string, unknown>, allowed: string[], where: string): string[] =>
	Object.keys(obj)
		.filter((k) => !allowed.includes(k))
		.map((k) => `${where} has an unknown key ${KEY_NAME_RE.test(k) ? `"${k}"` : '(name not shown)'} (allowed: ${allowed.join(', ')})`);

const extensionOf = (path: string): string => {
	const base = path.slice(path.lastIndexOf('/') + 1);
	const dot = base.lastIndexOf('.');
	return dot > 0 ? base.slice(dot) : '';
};

/** Checks an output path: under out/, safe characters only, the right extension for the kind. */
export const outputProblem = (output: unknown, kind: Kind | null): string | null => {
	if (typeof output !== 'string') return 'must be a string';
	if (output.length > LIMITS.outputChars) return `must be at most ${LIMITS.outputChars} characters`;
	if (!OUTPUT_RE.test(output)) return 'must be a relative path under out/ made of letters, digits, ".", "_", "-" and "/" (no segment may start with ".")';
	if (output.split('/').length - 1 > LIMITS.outputDepth) return `must be at most ${LIMITS.outputDepth} folders deep`;
	if (kind) {
		const ext = extensionOf(output);
		if (!EXTENSIONS[kind].includes(ext)) return `must end in ${EXTENSIONS[kind].join(' or ')} for kind "${kind}"`;
	}
	return null;
};

/** Where the voice step reads a storyboard for a voice entry (relative to projects/video-studio). */
export const voiceContentDir = (v: Pick<VoiceEntry, 'channel' | 'slug'>): string =>
	v.channel === FARM_CHANNEL ? `scripts/farm/fixtures/${FARM_CHANNEL}/${v.slug}` : `content/${v.channel}/${v.slug}`;

/** The voice step's output folder for a voice entry, relative to projects/video-studio/public. */
export const voiceOutputDir = (v: {channel: string; slug: string; lang: string}): string => `generated/${v.channel}/${v.slug}/${v.lang}`;

/**
 * Validates one parsed request file. `fileId` is the file name without .json; the request's id must equal it.
 * Returns every problem found, not only the first.
 */
export const validateRequest = (raw: unknown, fileId: string): Validation => {
	const errors: string[] = [];
	if (!ID_RE.test(fileId)) {
		return {ok: false, errors: ['the file name must be <id>.json, where id is 1-64 lowercase letters, digits and dashes, starting with a letter or digit']};
	}
	if (!isPlainObject(raw)) return {ok: false, errors: ['the request must be a JSON object']};
	errors.push(...unknownKeys(raw, TOP_KEYS, 'the request'));

	if (typeof raw.id !== 'string' || raw.id !== fileId) errors.push(`id must be a string equal to the file name ("${fileId}")`);

	const entryOk = isEntry(raw.entry);
	if (!entryOk) errors.push(`entry must be one of ${ENTRIES.join(', ')}`);
	const entry: Entry = entryOk ? (raw.entry as Entry) : ENTRIES[0];

	let encrypt = true;
	if ('encrypt' in raw) {
		if (typeof raw.encrypt === 'boolean') encrypt = raw.encrypt;
		else errors.push('encrypt must be true or false (it defaults to true)');
	}

	let retentionDays: number = LIMITS.retentionDefaultDays;
	if ('retentionDays' in raw) {
		const r = raw.retentionDays;
		if (typeof r === 'number' && Number.isInteger(r) && r >= LIMITS.retentionMinDays && r <= LIMITS.retentionMaxDays) retentionDays = r;
		else errors.push(`retentionDays must be an integer from ${LIMITS.retentionMinDays} to ${LIMITS.retentionMaxDays}`);
	}

	const jobs: RenderJob[] = [];
	if (!Array.isArray(raw.jobs) || raw.jobs.length === 0) {
		errors.push('jobs must be a non-empty array');
	} else if (raw.jobs.length > LIMITS.jobsPerRequest) {
		errors.push(`jobs may hold at most ${LIMITS.jobsPerRequest} entries; split the work into several requests`);
	} else {
		const outputs = new Set<string>();
		raw.jobs.forEach((j: unknown, i: number) => {
			const at = `jobs[${i}]`;
			if (!isPlainObject(j)) {
				errors.push(`${at} must be an object`);
				return;
			}
			const before = errors.length;
			errors.push(...unknownKeys(j, JOB_KEYS, at));
			if (typeof j.composition !== 'string' || !COMPOSITION_RE.test(j.composition)) errors.push(`${at}.composition must be 1-64 characters from A-Z, a-z, 0-9 and "-"`);
			const kind: Kind | null = j.kind === 'video' || j.kind === 'still' ? j.kind : null;
			if (!kind) errors.push(`${at}.kind must be "video" or "still"`);
			const op = outputProblem(j.output, kind);
			if (op) errors.push(`${at}.output ${op}`);
			else if (outputs.has(j.output as string)) errors.push(`${at}.output repeats the output of an earlier job`);
			else outputs.add(j.output as string);
			if (!isPlainObject(j.props)) {
				errors.push(`${at}.props must be a JSON object (use {} for none)`);
			} else if (Buffer.byteLength(JSON.stringify(j.props), 'utf8') > LIMITS.propsBytes) {
				errors.push(`${at}.props must be at most ${LIMITS.propsBytes} bytes as JSON`);
			}
			if ('entry' in j && !isEntry(j.entry)) errors.push(`${at}.entry must be one of ${ENTRIES.join(', ')}`);
			let frame = 0;
			if ('frame' in j) {
				const f = j.frame;
				if (kind === 'video') errors.push(`${at}.frame is only for kind "still"`);
				else if (typeof f === 'number' && Number.isInteger(f) && f >= 0 && f <= LIMITS.maxFrame) frame = f;
				else errors.push(`${at}.frame must be an integer from 0 to ${LIMITS.maxFrame}`);
			}
			if (errors.length !== before || !kind) return;
			const props = j.props as Record<string, unknown>;
			const lang = typeof props.lang === 'string' && (LANGS as readonly string[]).includes(props.lang) ? props.lang : null;
			jobs.push({
				composition: j.composition as string,
				props,
				output: j.output as string,
				kind,
				entry: isEntry(j.entry) ? j.entry : entry,
				frame,
				lang,
			});
		});
	}

	const voice: VoiceEntry[] = [];
	if ('voice' in raw) {
		if (!Array.isArray(raw.voice)) {
			errors.push('voice must be an array (or left out)');
		} else if (raw.voice.length > LIMITS.voicePerRequest) {
			errors.push(`voice may hold at most ${LIMITS.voicePerRequest} entries`);
		} else {
			const seen = new Set<string>();
			raw.voice.forEach((v: unknown, i: number) => {
				const at = `voice[${i}]`;
				if (!isPlainObject(v)) {
					errors.push(`${at} must be an object`);
					return;
				}
				const before = errors.length;
				errors.push(...unknownKeys(v, VOICE_KEYS, at));
				if (typeof v.channel !== 'string' || !CHANNEL_RE.test(v.channel)) errors.push(`${at}.channel must be lowercase letters, digits and "-" (1-48 characters)`);
				else if (v.channel.startsWith('_') && v.channel !== FARM_CHANNEL) errors.push(`${at}.channel may start with "_" only as "${FARM_CHANNEL}" (the farm's self-test fixtures)`);
				if (typeof v.slug !== 'string' || !SLUG_RE.test(v.slug)) errors.push(`${at}.slug must be lowercase letters, digits and "-" (1-96 characters)`);
				if (!isVoiceLang(v.lang)) errors.push(`${at}.lang must be one of ${VOICE_LANGS.join(', ')}`);
				if (v.voice !== ZOO_VOICE) errors.push(`${at}.voice must be "${ZOO_VOICE}" (Zoo's voice in every language, owner decision)`);
				if (errors.length !== before) return;
				const key = `${v.channel}/${v.slug}/${v.lang}`;
				if (seen.has(key)) {
					errors.push(`${at} repeats an earlier voice entry (same channel, slug and lang)`);
					return;
				}
				seen.add(key);
				voice.push({channel: v.channel as string, slug: v.slug as string, lang: v.lang as VoiceLang, voice: ZOO_VOICE});
			});
		}
	}

	if (!encrypt && errors.length === 0) {
		const nonTestJob = jobs.findIndex((j) => !TEST_ENTRIES.includes(j.entry));
		if (nonTestJob >= 0) {
			errors.push(`encrypt: false is only for test renders (entries ${TEST_ENTRIES.join(', ')}); jobs[${nonTestJob}] renders from another entry, so this request must be encrypted`);
		}
		const nonTestVoice = voice.findIndex((v) => v.channel !== FARM_CHANNEL);
		if (nonTestVoice >= 0) {
			errors.push(`encrypt: false is only for test renders; voice[${nonTestVoice}] voices real content, so this request must be encrypted`);
		}
	}

	if (errors.length) return {ok: false, errors};
	return {ok: true, request: {id: fileId, entry, jobs, voice, encrypt, retentionDays}};
};

/** Parses and validates request file text. */
export const parseRequest = (text: string, fileId: string): Validation => {
	if (Buffer.byteLength(text, 'utf8') > LIMITS.requestBytes) return {ok: false, errors: [`the file must be at most ${LIMITS.requestBytes} bytes`]};
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		// V8's message quotes the text around the error, so report only where it is.
		const pos = /position (\d+)/.exec(e instanceof Error ? e.message : '');
		if (!pos) return {ok: false, errors: ['the file is not valid JSON']};
		const before = text.slice(0, Number(pos[1]));
		const line = before.split('\n').length;
		const column = before.length - before.lastIndexOf('\n');
		return {ok: false, errors: [`the file is not valid JSON (line ${line}, column ${column})`]};
	}
	return validateRequest(raw, fileId);
};
