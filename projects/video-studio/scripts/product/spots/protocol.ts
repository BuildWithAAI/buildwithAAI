/**
 * Console transport between the spot composition (browser) and the Node build: the finished SVG is written to the
 * console in numbered chunks, because one console message can be truncated. Pure TypeScript with no imports, so
 * both webpack and Node (type stripping) load it.
 *
 * Line format: `[product-spot] <id> <i>/<n> <chunk>`.
 */
export const SPOT_LOG_TAG = '[product-spot]';
export const SPOT_CHUNK_CHARS = 50_000;

export const encodeSpotChunks = (id: string, svg: string, max = SPOT_CHUNK_CHARS): string[] => {
	const n = Math.max(1, Math.ceil(svg.length / max));
	const out: string[] = [];
	for (let i = 0; i < n; i++) out.push(`${SPOT_LOG_TAG} ${id} ${i + 1}/${n} ${svg.slice(i * max, (i + 1) * max)}`);
	return out;
};

export type SpotChunk = {id: string; index: number; count: number; data: string};

const LINE_RE = /^\[product-spot\] ([a-z0-9-]+) (\d+)\/(\d+) ([\s\S]*)$/;

/** Parses one console line; null when it is not a spot line. Tolerates text before the tag. */
export const decodeSpotChunk = (line: string): SpotChunk | null => {
	const at = line.indexOf(SPOT_LOG_TAG);
	if (at < 0) return null;
	const m = LINE_RE.exec(line.slice(at));
	if (!m) return null;
	const index = Number(m[2]);
	const count = Number(m[3]);
	if (!(index >= 1 && index <= count)) return null;
	return {id: m[1], index, count, data: m[4]};
};

/** Collects chunks for one id in any order; returns the whole payload once complete. */
export class SpotAssembler {
	private parts = new Map<string, {count: number; got: Map<number, string>}>();

	add(c: SpotChunk): string | null {
		let p = this.parts.get(c.id);
		if (!p || p.count !== c.count) {
			p = {count: c.count, got: new Map()};
			this.parts.set(c.id, p);
		}
		p.got.set(c.index, c.data);
		if (p.got.size < p.count) return null;
		this.parts.delete(c.id);
		let s = '';
		for (let i = 1; i <= p.count; i++) s += p.got.get(i) ?? '';
		return s;
	}
}
