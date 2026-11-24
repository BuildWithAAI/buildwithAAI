/**
 * Static checks on an exported spot SVG: the house style bans gradients, patterns, filters, blur, blend modes and
 * opacity tints (PROJECT_INSTRUCTIONS "Style and palette"; ART_GUIDE P1, CV1 and the QA scan in section 10), and the
 * PDF needs a viewBox, a printed size and a title (alt text). Pure functions.
 */
const BANNED: readonly [RegExp, string][] = [
	[/<(?:linear|radial)Gradient\b/i, 'gradient'],
	[/<pattern\b/i, 'pattern'],
	[/<filter\b|\bfilter\s*[:=]/i, 'filter'],
	[/feGaussianBlur|feTurbulence|feMorphology/i, 'filter primitive'],
	[/mix-blend-mode|\bmix-blend\b/i, 'blend mode'],
	[/<image\b/i, 'embedded raster image'],
	[/<script\b|\bon[a-z]+\s*=/i, 'script or event handler'],
	[/<foreignObject\b/i, 'foreignObject'],
];

/** Opacity below 1 on any element (fill-opacity, stroke-opacity, opacity, or rgba/hsla with alpha < 1). */
const opacityProblems = (svg: string): string[] => {
	const out: string[] = [];
	for (const m of svg.matchAll(/\b(fill-opacity|stroke-opacity|opacity)\s*[=:]\s*"?\s*([0-9.]+)/gi)) {
		if (Number(m[2]) < 1) out.push(`${m[1]}=${m[2]}`);
	}
	for (const m of svg.matchAll(/\b(?:rgba|hsla)\(([^)]*)\)/gi)) {
		const parts = m[1].split(/[,\s/]+/).filter(Boolean);
		const a = Number(parts[3] ?? '1');
		if (a < 1) out.push(m[0]);
	}
	return out;
};

export const checkSpotSvg = (svg: string): string[] => {
	const problems: string[] = [];
	if (!/^<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(svg)) problems.push('not a standalone <svg> with the SVG namespace');
	if (!/\bviewBox="-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+"/.test(svg)) problems.push('missing or malformed viewBox');
	if (!/\bwidth="[\d.]+"/.test(svg) || !/\bheight="[\d.]+"/.test(svg)) problems.push('missing printed width/height');
	if (!/<title>[^<]+<\/title>/.test(svg)) problems.push('missing <title> (alt text)');
	for (const [re, what] of BANNED) if (re.test(svg)) problems.push(`banned: ${what}`);
	const op = opacityProblems(svg);
	if (op.length) problems.push(`opacity tint: ${op.slice(0, 3).join(', ')}${op.length > 3 ? ', ...' : ''}`);
	if (/\bZOO\b/.test(svg)) problems.push('"ZOO" in upper case (write "Zoo")');
	return problems;
};
