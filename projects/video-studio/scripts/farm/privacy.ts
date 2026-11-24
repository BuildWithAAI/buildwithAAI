/**
 * The private names, searched in everything a gate receipt binds (docs/RENDER_FARM.md, "Gate receipts").
 *
 * The claim gate checks the names only where a script speaks or shows text (narration, on-screen text, titles,
 * thumbnails, sources, the ui strings, the dub sheets' translator, reviewer and notes) and only in the languages the
 * request targets. A receipt, though, binds every file of each script folder, and the commit that carries it makes all
 * of them public: research.md, notes, storyboards of other languages, back-translations, even the file names. The
 * request file is public too, props included. So before validate writes a receipt it searches every one of those files
 * (names and contents) and every string of the request (keys and values) with the claim gate's own matcher
 * (scripts/claims/lib/names.ts). A hit is reported by file or JSON path and entry number ("private name #2"), never by
 * the name or the text around it.
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {findNames, type NameList} from '../claims/lib/names.ts';
import {contentFiles} from './receipt.ts';

const KEY_RE = /^[A-Za-z_$][\w$]*$/;

const entries = (hits: Iterable<number>): string => {
	const n = [...new Set(hits)].sort((a, b) => a - b);
	return `private name${n.length > 1 ? 's' : ''} ${n.map((x) => `#${x}`).join(', ')}`;
};

/** Every string of a parsed JSON document, keys included, with where it sits ("jobs[0].props.title"). */
const jsonStrings = (doc: unknown, list: NameList): Array<{path: string; text: string}> => {
	const out: Array<{path: string; text: string}> = [];
	const walk = (x: unknown, path: string) => {
		if (typeof x === 'string') out.push({path: path || '(the whole document)', text: x});
		else if (Array.isArray(x)) x.forEach((y, i) => walk(y, `${path}[${i}]`));
		else if (x !== null && typeof x === 'object') {
			for (const [k, y] of Object.entries(x as Record<string, unknown>)) {
				// a key that holds a name is never shown, not even in the path of what sits under it
				const p = findNames(k, list).length ? `${path}[a key]` : KEY_RE.test(k) ? (path ? `${path}.${k}` : k) : `${path}[${JSON.stringify(k)}]`;
				out.push({path: `${p} (its key)`, text: k});
				walk(y, p);
			}
		}
	};
	walk(doc, '');
	return out;
};

/**
 * Problems for every private name found in the script folders (file names and contents) and in the request (its
 * parsed JSON, keys and values). `requestLabel` names the request file in messages. Throws FarmError when a folder
 * cannot be listed (git missing, a link): the caller refuses the request then too.
 */
export const privateNameProblems = (project: string, dirs: string[], requestLabel: string, requestJson: unknown, list: NameList): string[] => {
	if (!list.patterns.length) return [];
	const problems: string[] = [];
	for (const dir of dirs) {
		for (const f of contentFiles(project, dir)) {
			const inName = findNames(f, list);
			if (inName.length) {
				problems.push(`a file name in ${dir} holds ${entries(inName)}: the commit publishes file names too. Rename the file and validate again`);
				continue;
			}
			const hits = findNames(readFileSync(join(project, dir, f), 'utf8'), list);
			if (hits.length) {
				problems.push(`${dir}/${f} holds ${entries(hits)}: a gate receipt binds every file of the script folder and the commit makes them all public, not only the storyboards the claim gate reads. Replace the name with "[named person]" and validate again`);
			}
		}
	}
	const byPath = new Map<string, number[]>();
	for (const {path, text} of jsonStrings(requestJson, list)) {
		const hits = findNames(text, list);
		if (hits.length) byPath.set(path, [...(byPath.get(path) ?? []), ...hits]);
	}
	for (const [path, hits] of byPath) problems.push(`${requestLabel} at ${path} holds ${entries(hits)}: the request file is public once pushed. Remove the name and validate again`);
	return problems;
};
