/**
 * Provisional character drawings: poses the assets render but the owner has not accepted yet. The source of truth is
 * BADGER_PROVISIONAL_POSES (decision BADGER-D23: the left-facing sit and lie reuse the right-facing pose silhouette
 * mirrored), exported by the Badger index, src/characters/badger/index.ts. That index also pulls in the React
 * components, which Node cannot load, so this reader follows the index's own re-export to the module it names
 * (src/characters/badger/provisional.ts, kept React-free for tools) and loads that one. When the index no longer exports
 * the list (the owner accepted D23 and it was removed), nothing is provisional; when the module cannot be loaded, or the
 * index defines the list itself, the generated manifest's copy (manifest.v1.json "provisional.badger") is the fallback.
 */
import {existsSync, readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, relative, resolve} from 'node:path';

export type ProvisionalPose = {view: string; pose: string};
export type Provisional = {
	/** Where the list came from (for the report). */
	source: string;
	/** The decision that governs the list (BADGER_PROVISIONAL_DECISION), when known. */
	decision: string | null;
	poses: ProvisionalPose[];
};

const EXPORT_NAME = 'BADGER_PROVISIONAL_POSES';
const DECISION_NAME = 'BADGER_PROVISIONAL_DECISION';

/**
 * The module specifier the index re-exports `name` from, and the name it has there: `export {A, B as C} from './x'`.
 * Named re-exports only; loadProvisional also follows `export *` lines when the index has no named re-export.
 */
export const findReExport = (indexSource: string, name: string): {from: string; local: string} | null => {
	const re = /export\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
	for (let m = re.exec(indexSource); m; m = re.exec(indexSource)) {
		for (const raw of m[1].split(',')) {
			const spec = raw.trim().replace(/^type\s+/, '');
			if (!spec) continue;
			const [local, exported] = spec.split(/\s+as\s+/).map((s) => s.trim());
			if ((exported ?? local) === name) return {from: m[2], local};
		}
	}
	return null;
};

const isPoseList = (v: unknown): v is ProvisionalPose[] =>
	Array.isArray(v) && v.every((p) => p && typeof p === 'object' && typeof (p as ProvisionalPose).view === 'string' && typeof (p as ProvisionalPose).pose === 'string');

const fromManifest = (projectRoot: string, why: string): Provisional => {
	try {
		const raw = JSON.parse(readFileSync(join(projectRoot, 'src', 'characters', 'manifest.v1.json'), 'utf8')) as {provisional?: {badger?: {decision?: string; poses?: unknown}}};
		const b = raw.provisional?.badger;
		if (b && isPoseList(b.poses)) return {source: `src/characters/manifest.v1.json provisional.badger (${why})`, decision: b.decision ?? null, poses: b.poses};
	} catch {
		// no manifest: nothing is known to be provisional
	}
	return {source: `none (${why})`, decision: null, poses: []};
};

/** The `export * from '...'` specifiers of a module source. */
const starExports = (source: string): string[] => [...source.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

const resolveTs = (fromFile: string, spec: string): string | null => {
	const base = resolve(dirname(fromFile), spec);
	return [base, `${base}.ts`, join(base, 'index.ts')].find((f) => existsSync(f) && f.endsWith('.ts')) ?? null;
};

/** Loads the provisional Badger poses as the Badger index exports them (see the file comment for the fallbacks). */
export const loadProvisional = (projectRoot: string): Provisional => {
	const indexFile = join(projectRoot, 'src', 'characters', 'badger', 'index.ts');
	if (!existsSync(indexFile)) return fromManifest(projectRoot, 'no src/characters/badger/index.ts');
	const indexSource = readFileSync(indexFile, 'utf8');
	// a named re-export names the module and the local name; an `export *` may carry it under the same name
	const named = findReExport(indexSource, EXPORT_NAME);
	const candidates: Array<{from: string; local: string}> = named ? [named] : starExports(indexSource).map((from) => ({from, local: EXPORT_NAME}));
	if (!candidates.length) {
		// defined in the index itself: Node cannot load the index (it imports the React components), so use the manifest copy
		if (new RegExp(`export\\s+const\\s+${EXPORT_NAME}\\b`).test(indexSource)) return fromManifest(projectRoot, `${EXPORT_NAME} is defined in the Badger index, which Node cannot load`);
		return {source: `src/characters/badger/index.ts does not export ${EXPORT_NAME}`, decision: null, poses: []};
	}
	const problems: string[] = [];
	for (const c of candidates) {
		const file = resolveTs(indexFile, c.from);
		if (!file) {
			problems.push(`cannot resolve ${c.from} from the Badger index`);
			continue;
		}
		try {
			const mod = createRequire(import.meta.url)(file) as Record<string, unknown>;
			const poses = mod[c.local];
			if (poses === undefined && !named) continue; // an `export *` module without the list
			if (!isPoseList(poses)) {
				problems.push(`${relative(projectRoot, file)} exports no {view, pose} list as ${c.local}`);
				continue;
			}
			const decision = typeof mod[DECISION_NAME] === 'string' ? (mod[DECISION_NAME] as string) : null;
			return {source: `${relative(projectRoot, file)} (${EXPORT_NAME}, exported by src/characters/badger/index.ts)`, decision, poses};
		} catch (err) {
			problems.push(`could not load ${relative(projectRoot, file)}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
		}
	}
	if (!problems.length) return {source: `src/characters/badger/index.ts does not export ${EXPORT_NAME}`, decision: null, poses: []};
	return fromManifest(projectRoot, problems.join('; '));
};

/** The provisional entry a rendered Badger matches (its drawn view and pose), or null. */
export const provisionalMatch = (list: Provisional, view: string | null, pose: string | null): ProvisionalPose | null =>
	view && pose ? (list.poses.find((p) => p.view === view && p.pose === pose) ?? null) : null;

/**
 * The compositions that publish: the episode entry (Episode, EpisodeShort), the show entry (ShowEpisode, ShowShort) and
 * the thumbnail entry (Thumbnail). Decision BADGER-D23 keeps the provisional drawings out of published work until the
 * owner accepts them, so in these compositions model-provisional is an ERROR (decision INT-Q1, revised in integration
 * round 5). Everywhere else (the character sheets, the proof, MouthDemo, dev, probe and fixture compositions) it stays a
 * WARNING: those exist to show the drawings for review. Exact composition ids; a QA reference twin (QaRef-<id>) counts
 * as its composition.
 */
export const PRODUCTION_COMPOSITIONS: readonly string[] = ['Episode', 'EpisodeShort', 'ShowEpisode', 'ShowShort', 'Thumbnail'];

export const isProductionComposition = (compId: string): boolean => PRODUCTION_COMPOSITIONS.includes(compId.replace(/^QaRef-/, ''));

/** model-provisional's severity in a composition: an error where the work publishes, a warning everywhere else. */
export const provisionalSeverity = (compId: string): 'error' | 'warn' => (isProductionComposition(compId) ? 'error' : 'warn');
