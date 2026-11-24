import type {Pt} from './shared';

/**
 * Points ON an absolute SVG path (M / L / C / Q / S / Z), sampled `n` times per segment. Used where geometry must
 * be measured on the drawn curve rather than on its control points (ground contact of the walking paws, dev QA).
 */
export const samplePath = (d: string, n = 8): Pt[] => {
	const tok = d.match(/[MLCQSZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
	const out: Pt[] = [];
	let i = 0;
	let cmd = '';
	let cur: Pt = {x: 0, y: 0};
	let start: Pt = cur;
	const st: {lastCtrl: Pt | null} = {lastCtrl: null};
	const num = () => Number(tok[i++]);
	const cubic = (c1: Pt, c2: Pt, p: Pt) => {
		for (let k = 1; k <= n; k++) {
			const s = k / n;
			const u = 1 - s;
			out.push({
				x: u * u * u * cur.x + 3 * u * u * s * c1.x + 3 * u * s * s * c2.x + s * s * s * p.x,
				y: u * u * u * cur.y + 3 * u * u * s * c1.y + 3 * u * s * s * c2.y + s * s * s * p.y,
			});
		}
		st.lastCtrl = c2;
		cur = p;
	};
	const line = (p: Pt) => {
		for (let k = 1; k <= n; k++) out.push({x: cur.x + ((p.x - cur.x) * k) / n, y: cur.y + ((p.y - cur.y) * k) / n});
		st.lastCtrl = null;
		cur = p;
	};
	while (i < tok.length) {
		if (/[A-Za-z]/.test(tok[i])) {
			cmd = tok[i++].toUpperCase();
			if (cmd === 'Z') {
				line(start);
				cmd = '';
			}
			continue;
		}
		if (cmd === 'M') {
			cur = {x: num(), y: num()};
			start = cur;
			out.push(cur);
			cmd = 'L';
		} else if (cmd === 'L') {
			line({x: num(), y: num()});
		} else if (cmd === 'C') {
			const c1 = {x: num(), y: num()};
			const c2 = {x: num(), y: num()};
			cubic(c1, c2, {x: num(), y: num()});
		} else if (cmd === 'S') {
			const lc = st.lastCtrl;
			const c1: Pt = lc ? {x: 2 * cur.x - lc.x, y: 2 * cur.y - lc.y} : cur;
			const c2 = {x: num(), y: num()};
			cubic(c1, c2, {x: num(), y: num()});
		} else if (cmd === 'Q') {
			const q = {x: num(), y: num()};
			const p = {x: num(), y: num()};
			cubic({x: cur.x + (2 / 3) * (q.x - cur.x), y: cur.y + (2 / 3) * (q.y - cur.y)}, {x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y)}, p);
		} else {
			i++;
		}
	}
	return out;
};
