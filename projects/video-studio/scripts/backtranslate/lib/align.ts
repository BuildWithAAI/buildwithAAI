/**
 * Sentence alignment between the English source and the back-translation (pure): a small dynamic programme over
 * 1-1, 2-1 and 1-2 pairings, plus omissions (a source sentence with no counterpart) and additions. Costs come from the
 * content-word overlap, so a merged pair of sentences still finds its partner and a dropped warning shows as an
 * omission instead of being glued to its neighbour.
 */
import {textOverlap} from './similarity.ts';

export type AlignPair = {src: number[]; back: number[]; sim: number};

// An omission (0.6) must be cheaper than gluing an unmatched sentence onto a good 1-1 pair (merge 0.3 + the overlap the
// extra sentence costs), or a dropped warning would hide inside its neighbour. Two skips (1.2) still cost more than
// any 1-1 pair, so equal counts always pair up.
const SKIP = 0.6;
const MERGE = 0.3;
const GAIN = 0.02;

export const alignSentences = (src: string[], back: string[]): AlignPair[] => {
	const m = src.length;
	const n = back.length;
	const memo = new Map<string, number>();
	const sim = (a: number[], b: number[]): number => {
		const key = `${a.join(',')}|${b.join(',')}`;
		const hit = memo.get(key);
		if (hit !== undefined) return hit;
		const v = textOverlap(a.map((i) => src[i]).join(' '), b.map((j) => back[j]).join(' ')).score;
		memo.set(key, v);
		return v;
	};
	const INF = Number.POSITIVE_INFINITY;
	const cost: number[][] = Array.from({length: m + 1}, () => new Array<number>(n + 1).fill(INF));
	const prev: Array<Array<[number, number] | null>> = Array.from({length: m + 1}, () => new Array<[number, number] | null>(n + 1).fill(null));
	cost[0][0] = 0;
	const relax = (i: number, j: number, di: number, dj: number, c: number) => {
		const ni = i + di;
		const nj = j + dj;
		if (ni > m || nj > n) return;
		if (cost[i][j] + c < cost[ni][nj] - 1e-12) {
			cost[ni][nj] = cost[i][j] + c;
			prev[ni][nj] = [di, dj];
		}
	};
	for (let i = 0; i <= m; i++) {
		for (let j = 0; j <= n; j++) {
			if (cost[i][j] === INF) continue;
			if (i < m && j < n) relax(i, j, 1, 1, 1 - sim([i], [j]));
			if (i < m) relax(i, j, 1, 0, SKIP);
			if (j < n) relax(i, j, 0, 1, SKIP);
			// a true merge brings in content from both sentences, so it scores higher than either alone; an extra
			// sentence that adds nothing (a dropped one sitting next to its neighbour) must be an omission instead
			if (i + 1 < m && j < n) {
				const mm = sim([i, i + 1], [j]);
				if (mm > Math.max(sim([i], [j]), sim([i + 1], [j])) + GAIN) relax(i, j, 2, 1, 1 - mm + MERGE);
			}
			if (i < m && j + 1 < n) {
				const mm = sim([i], [j, j + 1]);
				if (mm > Math.max(sim([i], [j]), sim([i], [j + 1])) + GAIN) relax(i, j, 1, 2, 1 - mm + MERGE);
			}
		}
	}
	const pairs: AlignPair[] = [];
	let i = m;
	let j = n;
	while (i > 0 || j > 0) {
		const p = prev[i][j];
		if (!p) break;
		const [di, dj] = p;
		const s = Array.from({length: di}, (_, k) => i - di + k);
		const b = Array.from({length: dj}, (_, k) => j - dj + k);
		pairs.push({src: s, back: b, sim: s.length && b.length ? sim(s, b) : 0});
		i -= di;
		j -= dj;
	}
	return pairs.reverse();
};
