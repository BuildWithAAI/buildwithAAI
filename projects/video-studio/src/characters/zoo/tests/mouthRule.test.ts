/**
 * The rest-mouth rule (repair round 6, decision ZOO-E7; R5 review): the Episode and Show engines pass an explicit mouth on
 * every frame, 'closed' whenever Zoo is silent (src/episode/perf/zoo.ts, src/show/perf/plan.ts). Every Zoo head (front,
 * 3/4, profile) resolves its mouth through rig.ts mouthFor, so a SILENT frame must draw the expression's own mouth: the
 * shocked gasp (SHOCKED_MOUTH), the happy smile line (HAPPY_MOUTH) and the worried downturn, each with its full modifiers,
 * while spoken shapes stay the fixed six-shape library.
 * Run: cd projects/video-studio && node --test src/characters/zoo/tests/mouthRule.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {EXPRESSIONS, explicitMod, MOD0, mouthFor} from '../rig.ts';
import {HAPPY_MOUTH, MOUTHS, SHOCKED_MOUTH} from '../mouth.ts';
import type {Expression, MouthShape} from '../../types.ts';

const EXPRS: Expression[] = ['neutral', 'happy', 'worried', 'shocked'];
const SPOKEN: MouthShape[] = ['slightlyOpen', 'ah', 'ee', 'oh', 'mbp'];

test('a silent shocked frame (explicit "closed") draws the gasp with the full modifiers', () => {
	const m = mouthFor('shocked', 'closed');
	assert.equal(m.spec, SHOCKED_MOUTH);
	assert.equal(m.shape, 'ah');
	assert.deepEqual(m.mod, EXPRESSIONS.shocked.mod);
});

test('a silent happy frame (explicit "closed") draws HAPPY_MOUTH with the full smile and moustache pose', () => {
	const m = mouthFor('happy', 'closed');
	assert.equal(m.spec, HAPPY_MOUTH);
	assert.equal(m.shape, 'closed');
	assert.deepEqual(m.mod, EXPRESSIONS.happy.mod);
	assert.ok(m.mod.cornerR > m.mod.cornerL, 'the smirk lifts the screen-right corner more');
	assert.ok((m.mod.moustacheLiftR ?? 0) > (m.mod.moustacheLiftL ?? 0), 'the screen-right moustache half rises more');
});

test('silence equals no explicit mouth for every expression', () => {
	for (const e of EXPRS) assert.deepEqual(mouthFor(e, 'closed'), mouthFor(e, undefined), e);
});

test('the silent worried mouth keeps its full downturn; neutral stays the flat closed line', () => {
	assert.deepEqual(mouthFor('worried', 'closed').mod, EXPRESSIONS.worried.mod);
	assert.equal(mouthFor('worried', 'closed').spec, undefined);
	assert.deepEqual(mouthFor('neutral', 'closed'), {shape: 'closed', mod: MOD0, spec: undefined});
});

test('spoken shapes draw the fixed library with softened corners and the full moustache pose', () => {
	for (const e of EXPRS)
		for (const s of SPOKEN) {
			const m = mouthFor(e, s);
			assert.equal(m.shape, s);
			assert.equal(m.spec, undefined, `${e}/${s} must use MOUTHS.${s}`);
			assert.ok(MOUTHS[s], s);
			assert.deepEqual(m.mod, explicitMod(EXPRESSIONS[e].mod));
			// the moustache belongs to the expression: no flapping between silent and spoken frames
			assert.equal(m.mod.moustacheLiftR, EXPRESSIONS[e].mod.moustacheLiftR);
			assert.equal(m.mod.moustacheLiftL ?? 0, EXPRESSIONS[e].mod.moustacheLiftL ?? 0);
			assert.equal(m.mod.moustacheRaise ?? 0, EXPRESSIONS[e].mod.moustacheRaise ?? 0);
			assert.equal(m.mod.moustacheThin ?? 0, EXPRESSIONS[e].mod.moustacheThin ?? 0);
		}
});

test('the happy rest mouth is a restrained smirk: <= 3 u deep with the corner lifts, ~33 u wide', () => {
	if (HAPPY_MOUTH.kind !== 'line') throw new Error('HAPPY_MOUTH must be a line');
	const {cornerL, cornerR} = EXPRESSIONS.happy.mod;
	// the corner lift profile of parts/Mouth.tsx makeMap, on the line's key points
	const hw = Math.max(...HAPPY_MOUTH.line.map((p) => Math.abs(p[0])));
	const ys = HAPPY_MOUTH.line.map((p) => {
		const u = p[0] / hw;
		const tR = Math.pow(Math.min(1, Math.max(0, (u - 0.15) / 0.85)), 1.6);
		const tL = Math.pow(Math.min(1, Math.max(0, (-u - 0.15) / 0.85)), 1.6);
		return p[1] - cornerR * tR - cornerL * tL;
	});
	const lowest = Math.max(...ys);
	const depthL = lowest - ys[0];
	const depthR = lowest - ys[ys.length - 1];
	assert.ok(depthL > 0.5 && depthR > depthL, `both corners rise, the screen-right one more (L ${depthL} R ${depthR})`);
	assert.ok(depthL <= 3 && depthR <= 3, `depth L ${depthL} R ${depthR}`);
	const xs = HAPPY_MOUTH.line.map((p) => p[0]);
	const width = Math.max(...xs) - Math.min(...xs);
	assert.ok(width >= 30 && width <= 36, `width ${width}`);
	assert.deepEqual(EXPRESSIONS.happy.eyes.lidTop, 0, 'eyes stay open (Prompt 1)');
	assert.ok(EXPRESSIONS.happy.eyes.lidBottom <= 0.8, 'at most a small lower-lid lift');
});
