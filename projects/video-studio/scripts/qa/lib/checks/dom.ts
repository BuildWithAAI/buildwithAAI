/**
 * Checks that need only the probe's DOM facts (run on every scouted frame): text clipping and overflow,
 * text size, safe zones, captions and text over faces, character transforms, effects, identity facts against
 * the frozen manifest, banned render techniques, and elements that exist for a single frame.
 */
import {applyTextTransform, type CharacterFact, type FrameFacts, type Rect, type TextFact} from '../../../../src/qa/protocol.ts';
import {inflate, intersectRect, rectArea, unionRect} from '../image.ts';
import type {Finding, Severity} from '../issues.ts';
import {expectedBadgerBody, type Manifest} from '../manifest.ts';
import {provisionalMatch} from '../provisional.ts';
import {THRESHOLDS as T} from '../thresholds.ts';
import {outside, type Zones} from '../zones.ts';

const r0 = (n: number) => Math.round(n);
const q = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 3)}...` : s);
export const charName = (c: Pick<CharacterFact, 'kind'>) => (c.kind === 'zoo' ? 'Zoo' : 'Badger');
export const charLabel = (c: CharacterFact, i: number) => `${charName(c)} #${i + 1}`;

/** Identity of a text node across frames (its DOM slot and content). */
export const textKey = (t: Pick<TextFact, 'path' | 'text'>) => `${t.path}|${t.text}`;
export const charKey = (c: Pick<CharacterFact, 'key'>) => `char:${c.key}`;

/**
 * The host's name in capitals as a word ("ZOO", "ZOO'S", "$ZOO"; not "ZOORA"). Owner rule (CLAUDE.md, 2026-11-24):
 * the host is "Zoo", title case, never "ZOO", on screen as everywhere else.
 */
export const HOST_CAPS = /(?<![\p{L}\p{N}])ZOO(?![\p{L}\p{N}])/u;

/** Texts the geometry checks look at: not review badges, not faded out. */
export const liveTexts = (f: FrameFacts): TextFact[] => f.texts.filter((t) => t.role !== 'badge' && t.opacity >= T.text.minOpacity);

/** The part of a character's head box inside the frame (null when off-frame or missing). */
export const visibleHead = (c: CharacterFact, f: FrameFacts): Rect | null => (c.headBox ? intersectRect(c.headBox, {x: 0, y: 0, w: f.width, h: f.height}) : null);

export const textFindings = (f: FrameFacts): Finding[] => {
	const out: Finding[] = [];
	for (const t of f.texts) {
		if (t.role === 'badge' || t.opacity < T.text.minOpacity) continue;
		const subject = `"${q(t.text)}"`;
		const key = `${t.role}|${t.text}|${t.path}`;
		const elementKey = textKey(t);
		if (t.visibleFrac < T.text.minVisible) {
			const offFrame = t.clippedBy.includes('frame');
			// fully hidden (before a wipe or slide-in, or parked off-frame) shows no cut letters: information only
			const sev: Severity = t.visibleFrac < 0.02 ? 'info' : 'error';
			out.push({
				check: offFrame ? 'text-offframe' : 'text-clipped',
				severity: sev,
				frame: f.frame,
				box: t.box,
				subject,
				key,
				message: t.visibleFrac < 0.02 ? `the text is fully hidden by ${t.clippedBy.join(', ')} (not shown in this frame)` : `${Math.round((1 - t.visibleFrac) * 100)}% of the text is cut off (${t.clippedBy.join(', ')})`,
				measured: {visiblePercent: Math.round(t.visibleFrac * 1000) / 10, clippedBy: t.clippedBy.join(', '), role: t.role},
				score: 1 - t.visibleFrac,
				elementKey,
			});
		} else if (t.overflow) {
			// the plate the text sits on: letters over its border are sloppy, letters past its edge are broken
			const o = t.overflow;
			const worst = Math.max(o.left, o.right, o.top, o.bottom);
			if (worst > T.text.overflowPx) {
				const off = o.beyondPlate > T.text.offPlatePx;
				out.push({
					check: 'text-overflow',
					severity: off ? 'error' : 'warn',
					frame: f.frame,
					box: t.box,
					subject,
					key,
					message: off
						? `text hangs ${r0(o.beyondPlate)} px off the edge of its plate (left ${r0(o.left)}, right ${r0(o.right)}, top ${r0(o.top)}, bottom ${r0(o.bottom)} px past its padding)`
						: `text runs into the edge of its plate by ${r0(worst)} px (left ${r0(o.left)}, right ${r0(o.right)}, top ${r0(o.top)}, bottom ${r0(o.bottom)})`,
					measured: {left: r0(o.left), right: r0(o.right), top: r0(o.top), bottom: r0(o.bottom), beyondPlate: r0(o.beyondPlate)},
					related: [{rect: o.box, label: 'plate'}],
					score: worst + o.beyondPlate,
					elementKey,
				});
			}
		} else if (t.blockOverflow) {
			// no plate: only the layout box is exceeded (nothing is cut; the frame, safe-area and collision checks
			// cover where the letters land). Information, and only beyond a descender's worth.
			const o = t.blockOverflow;
			const worst = Math.max(o.left, o.right, o.top, o.bottom);
			if (worst > T.text.layoutOverflowEm * Math.max(1, t.fontPx))
				out.push({
					check: 'text-overflow',
					severity: 'info',
					frame: f.frame,
					box: t.box,
					subject,
					key,
					message: `text extends ${r0(worst)} px beyond its layout box (no plate behind it, nothing is cut)`,
					measured: {left: r0(o.left), right: r0(o.right), top: r0(o.top), bottom: r0(o.bottom)},
					related: [{rect: o.box, label: 'layout box'}],
					score: 0,
					elementKey,
				});
		}
		if (t.truncated)
			out.push({
				check: 'text-truncated',
				severity: 'info',
				frame: f.frame,
				box: t.box,
				subject,
				key,
				message: `shortened on purpose (${t.truncated}); the full text must be available elsewhere (description)`,
				measured: {mode: t.truncated},
				score: 0,
				elementKey,
			});
		if (!t.script && t.effPx > 0 && t.effPx < T.text.minPx - 0.25)
			out.push({
				check: 'text-small',
				severity: 'warn',
				frame: f.frame,
				box: t.box,
				subject,
				key,
				message: `${t.effPx} px on screen (minimum ${T.text.minPx} px, ART_GUIDE SL10)`,
				measured: {px: t.effPx, fontPx: t.fontPx},
				score: T.text.minPx - t.effPx,
				elementKey,
			});
		// the painted text is checked, so a CSS uppercase style on "Zoo" counts as well
		const shown = applyTextTransform(t.text, t.transform);
		if (t.visibleFrac > 0 && HOST_CAPS.test(shown))
			out.push({
				check: 'text-name',
				severity: 'error',
				frame: f.frame,
				box: t.box,
				subject: `"${q(shown)}"`,
				key,
				message: /\$ZOO(?![\p{L}\p{N}])/u.test(shown)
					? 'the ticker "$ZOO" spells the host\'s name in capitals (owner rule: "Zoo", never "ZOO"); use another fictional ticker'
					: HOST_CAPS.test(t.text)
						? 'the host\'s name is written "ZOO"; the owner rule is title case "Zoo"'
						: `the host's name is painted "ZOO" by CSS text-transform: ${t.transform}; the owner rule is title case "Zoo"`,
				measured: {transform: t.transform ?? 'none'},
				score: 1,
				elementKey,
			});
	}
	return out;
};

/** Ink area two texts share (their line rects intersected pairwise). */
const sharedInk = (a: TextFact, b: TextFact): number => {
	let s = 0;
	for (const ra of a.rects) for (const rb of b.rects) s += rectArea(intersectRect(ra, rb));
	return s;
};

/**
 * Two different texts painted over each other: unreadable whatever their colours (a long dubbed title running
 * into a source line, a label pushed into a caption). Adjacent words of one line touch by a pixel or two, so the
 * shared ink must be a real share of the smaller text; a text drawn twice on purpose (an outline layer under a
 * fill layer: same string, same box) is not a collision.
 */
export const collisionFindings = (f: FrameFacts): Finding[] => {
	const out: Finding[] = [];
	const texts = liveTexts(f).filter((t) => t.visibleFrac > 0.5);
	for (let i = 0; i < texts.length; i++)
		for (let j = i + 1; j < texts.length; j++) {
			const a = texts[i];
			const b = texts[j];
			if (!intersectRect(a.box, b.box)) continue;
			const shared = sharedInk(a, b);
			const small = Math.min(rectArea(a.box), rectArea(b.box));
			if (shared < T.text.collisionMinPx || shared < T.text.collisionFrac * small) continue;
			const ab = intersectRect(a.box, b.box) as Rect;
			const iou = rectArea(ab) / (rectArea(a.box) + rectArea(b.box) - rectArea(ab));
			if (a.text === b.text && iou > 0.9) continue;
			const [first, second] = textKey(a) < textKey(b) ? [a, b] : [b, a];
			out.push({
				check: 'text-collision',
				severity: 'error',
				frame: f.frame,
				box: unionRect([a.box, b.box]) as Rect,
				subject: `"${q(first.text, 40)}" and "${q(second.text, 40)}"`,
				key: `${textKey(first)}||${textKey(second)}`,
				message: `two texts are painted over each other (${r0(shared)} px² of shared ink, ${Math.round((shared / Math.max(1, small)) * 100)}% of the smaller one)`,
				measured: {sharedPx: r0(shared), sharedPercent: Math.round((shared / Math.max(1, small)) * 100)},
				related: [
					{rect: a.box, label: 'text'},
					{rect: b.box, label: 'text'},
				],
				score: shared,
				elementKey: textKey(first),
				elementKey2: textKey(second),
			});
		}
	return out;
};

/** Safe area (both formats) and the Shorts UI zones (9:16). Captions are merged per frame. */
export const zoneFindings = (f: FrameFacts, z: Zones): Finding[] => {
	const out: Finding[] = [];
	const frameRect = {x: 0, y: 0, w: f.width, h: f.height};
	const texts = liveTexts(f).filter((t) => t.visibleFrac > 0);
	const captions = texts.filter((t) => t.role === 'caption');
	const others = texts.filter((t) => t.role !== 'caption');
	const items: Array<{box: Rect; subject: string; key: string; kind: 'caption' | 'text' | 'face' | 'hand'; sev: Severity; offFrac?: number; elementKey?: string}> = [];
	const capBox = unionRect(captions.map((t) => t.box));
	if (capBox) items.push({box: capBox, subject: `caption "${q(captions.map((t) => t.text).join(' '), 50)}"`, key: 'caption', kind: 'caption', sev: 'error', elementKey: 'captions'});
	for (const t of others) items.push({box: t.box, subject: `"${q(t.text)}"`, key: `text|${t.text}`, kind: 'text', sev: 'error', elementKey: textKey(t)});
	f.chars.forEach((c, i) => {
		if (!c.headBox || c.effects.opacity < T.text.minOpacity) return;
		const vis = intersectRect(c.headBox, frameRect);
		const offFrac = 1 - rectArea(vis) / Math.max(1, rectArea(c.headBox));
		if (!vis) return;
		// a head mostly outside the frame is an entrance or exit: still reported, as a warning
		items.push({box: c.headBox, subject: `${charLabel(c, i)} face${c.kind === 'badger' ? ' and ears' : ''}`, key: `face|${c.key}`, kind: 'face', sev: offFrac > 0.6 ? 'warn' : 'error', offFrac, elementKey: charKey(c)});
		c.hands.forEach((h, k) => {
			// a hand behind other artwork (Zoo's hands below the show desk) is not on screen at all
			const vis = c.handsVisible?.[k] ?? -1;
			if (vis >= 0 && vis < T.faces.handVisibleMin) return;
			// one issue per character and side, however the hands move
			if (intersectRect(h, frameRect)) items.push({box: h, subject: `${charLabel(c, i)} hand`, key: `hand|${c.key}`, kind: 'hand', sev: 'warn', elementKey: charKey(c)});
		});
	});
	for (const it of items) {
		const o = outside(it.box, z.safe);
		if (o.max > 1) {
			const sides = (['left', 'right', 'top', 'bottom'] as const).filter((s) => o[s] > 1).map((s) => `${s} ${r0(o[s])} px`);
			out.push({
				check: 'safe-area',
				severity: it.sev,
				frame: f.frame,
				box: it.box,
				subject: it.subject,
				key: `${it.key}|${sides.map((s) => s.split(' ')[0]).join('+')}`,
				message: `${it.kind} sits outside the ${z.format} safe area by ${sides.join(', ')}${it.offFrac && it.offFrac > 0 ? ` (${Math.round(it.offFrac * 100)}% off-frame)` : ''}`,
				measured: {left: r0(o.left), right: r0(o.right), top: r0(o.top), bottom: r0(o.bottom)},
				related: [{rect: z.safe, label: 'safe area'}],
				score: o.max,
				elementKey: it.elementKey,
			});
		}
		for (const zone of z.ui) {
			const hit = intersectRect(it.box, zone.rect);
			if (!hit || (it.kind === 'hand')) continue;
			const frac = rectArea(hit) / Math.max(1, rectArea(it.box));
			if (frac < 0.02) continue;
			const sev: Severity = it.kind === 'face' ? (frac > 0.25 ? 'error' : 'warn') : frac >= 0.1 ? 'error' : 'warn';
			out.push({
				check: 'shorts-ui',
				severity: sev,
				frame: f.frame,
				box: it.box,
				subject: it.subject,
				key: `${it.key}|${zone.name}`,
				message: `${Math.round(frac * 100)}% of the ${it.kind} is under the ${zone.name}`,
				measured: {coveredPercent: Math.round(frac * 100), zone: zone.name},
				related: [{rect: zone.rect, label: zone.name}],
				score: frac,
				elementKey: it.elementKey,
			});
		}
		if (z.adsSafe && it.kind !== 'hand') {
			const o2 = outside(it.box, z.adsSafe);
			if (o2.max > 1)
				out.push({
					check: 'shorts-ads',
					severity: 'info',
					frame: f.frame,
					box: it.box,
					subject: it.subject,
					key: it.key,
					message: `outside Google's vertical-ads safe zone by up to ${r0(o2.max)} px (fine for organic Shorts)`,
					measured: {max: r0(o2.max)},
					related: [{rect: z.adsSafe, label: 'ads safe zone'}],
					score: o2.max,
					elementKey: it.elementKey,
				});
		}
	}
	return out;
};

/** Captions and other text over faces, and inside a face's clear zone (one head-width, ART_GUIDE CV4c). */
export const faceFindings = (f: FrameFacts): Finding[] => {
	const out: Finding[] = [];
	const texts = liveTexts(f).filter((t) => t.visibleFrac > 0);
	f.chars.forEach((c, i) => {
		const head = visibleHead(c, f);
		if (!head || c.effects.opacity < T.text.minOpacity) return;
		const zone = inflate(head, Math.max(head.w, head.h) * T.faces.zoneWidths * 0.5);
		const caps = texts.filter((t) => t.role === 'caption');
		const capHits = caps.filter((t) => t.rects.some((r) => intersectRect(r, head)));
		if (capHits.length) {
			const box = unionRect(capHits.flatMap((t) => t.rects)) as Rect;
			const ov = intersectRect(box, head);
			out.push({
				check: 'caption-face',
				severity: 'error',
				frame: f.frame,
				box,
				subject: `caption "${q(capHits.map((t) => t.text).join(' '), 50)}" over ${charLabel(c, i)}`,
				key: c.key,
				message: `the caption covers ${Math.round((rectArea(ov) / Math.max(1, rectArea(head))) * 100)}% of ${charName(c)}'s face box`,
				measured: {overlapPx: r0(rectArea(ov)), facePercent: Math.round((rectArea(ov) / Math.max(1, rectArea(head))) * 100)},
				related: [{rect: head, label: 'face'}],
				score: rectArea(ov),
				elementKey: 'captions',
			});
		}
		for (const t of texts) {
			if (t.role === 'caption') continue;
			const hit = t.rects.some((r) => intersectRect(r, head));
			if (hit) {
				const ov = intersectRect(t.box, head);
				out.push({
					check: 'text-face',
					severity: 'error',
					frame: f.frame,
					box: t.box,
					subject: `"${q(t.text)}" over ${charLabel(c, i)}`,
					key: `${c.key}|${t.text}`,
					message: `text overlaps ${charName(c)}'s face box (${r0(rectArea(ov))} px²)`,
					measured: {overlapPx: r0(rectArea(ov))},
					related: [{rect: head, label: 'face'}],
					score: rectArea(ov),
					elementKey: textKey(t),
				});
			} else if (t.rects.some((r) => intersectRect(r, zone))) {
				out.push({
					check: 'text-face-zone',
					severity: 'info',
					frame: f.frame,
					box: t.box,
					subject: `text near ${charLabel(c, i)} ("${q(t.text, 30)}")`,
					key: `${c.key}|text`,
					message: `text inside the clear zone around ${charName(c)}'s face (ART_GUIDE CV4c: no text within about one head-width)`,
					measured: {},
					related: [
						{rect: head, label: 'face'},
						{rect: zone, label: 'clear zone'},
					],
					score: 0.5,
				});
			}
		}
		// captions in the clear zone (not on the face)
		if (!capHits.length) {
			const near = caps.filter((t) => t.rects.some((r) => intersectRect(r, zone)));
			if (near.length) {
				const box = unionRect(near.flatMap((t) => t.rects)) as Rect;
				out.push({
					check: 'text-face-zone',
					severity: 'info',
					frame: f.frame,
					box,
					subject: `caption near ${charLabel(c, i)}`,
					key: `${c.key}|caption`,
					message: `caption inside the clear zone around ${charName(c)}'s face (ART_GUIDE CV4c: no text within about one head-width)`,
					measured: {},
					related: [
						{rect: head, label: 'face'},
						{rect: zone, label: 'clear zone'},
					],
					score: 0.5,
				});
			}
		}
	});
	return out;
};

/** Decompose a 2x2 linear part: scale x/y, rotation, skew (degrees), reflection. */
export const decompose = (m: [number, number, number, number, number, number]) => {
	const [a, b, c, d] = m;
	const det = a * d - b * c;
	const sx = Math.hypot(a, b);
	const rot = Math.atan2(b, a);
	const shear = (a * c + b * d) / (sx * sx || 1);
	const sy = det / (sx || 1);
	return {sx, sy, det, rotationDeg: (rot * 180) / Math.PI, skewDeg: (Math.atan(shear) * 180) / Math.PI, mirrored: det < 0};
};

const BANNED_FILTER = /blur\(|drop-shadow\(|url\(/;

export const characterDomFindings = (f: FrameFacts, manifest: Manifest): Finding[] => {
	const out: Finding[] = [];
	f.chars.forEach((c, i) => {
		const who = charLabel(c, i);
		const base = {frame: f.frame, box: c.box, subject: who, charIndex: i} as const;
		if (c.ctm) {
			const d = decompose(c.ctm);
			const aniso = Math.abs(Math.abs(d.sy) / (d.sx || 1) - 1);
			if (d.mirrored)
				out.push({...base, check: 'model-transform', severity: 'error', key: `${c.key}|mirror`, message: `${who} is mirrored (det ${d.det.toFixed(3)}): asymmetric characters are never flipped (PROJECT_INSTRUCTIONS)`, measured: {det: Number(d.det.toFixed(4))}, score: 10, thumb: {kind: 'compare', ref: 'solo-vs-ref'}});
			if (aniso > T.model.anisotropy)
				out.push({...base, check: 'model-transform', severity: 'error', key: `${c.key}|stretch`, message: `${who} is stretched: x scale ${d.sx.toFixed(3)} vs y scale ${Math.abs(d.sy).toFixed(3)} (${Math.round(aniso * 100)}%)`, measured: {sx: Number(d.sx.toFixed(4)), sy: Number(Math.abs(d.sy).toFixed(4))}, score: aniso * 10, thumb: {kind: 'compare', ref: 'solo-vs-ref'}});
			if (Math.abs(d.skewDeg) > T.model.angleDeg)
				out.push({...base, check: 'model-transform', severity: 'error', key: `${c.key}|skew`, message: `${who} is skewed ${d.skewDeg.toFixed(1)}°`, measured: {skewDeg: Number(d.skewDeg.toFixed(2))}, score: Math.abs(d.skewDeg), thumb: {kind: 'compare', ref: 'solo-vs-ref'}});
			if (Math.abs(d.rotationDeg) > T.model.angleDeg && Math.abs(Math.abs(d.rotationDeg) - 180) > T.model.angleDeg)
				out.push({...base, check: 'model-transform', severity: 'warn', key: `${c.key}|rotate`, message: `${who} is rotated ${d.rotationDeg.toFixed(1)}° as a whole (the rig tilts the head; the body stays upright)`, measured: {rotationDeg: Number(d.rotationDeg.toFixed(2))}, score: Math.abs(d.rotationDeg), thumb: {kind: 'compare', ref: 'solo-vs-ref'}});
		}
		for (const fx of c.effects.filter)
			out.push({...base, check: 'model-effect', severity: 'error', key: `${c.key}|filter|${fx}`, message: `${who} is drawn through a filter (${fx}); characters are flat solid fills only (ART_GUIDE P1)`, measured: {filter: fx}, score: BANNED_FILTER.test(fx) ? 2 : 1, thumb: {kind: 'compare', ref: 'solo-vs-ref'}});
		for (const b of c.effects.blend)
			out.push({...base, check: 'model-effect', severity: 'error', key: `${c.key}|blend|${b}`, message: `${who} is drawn with a blend mode (${b}): unplanned mid-tones (ART_GUIDE CV1)`, measured: {blend: b}, score: 1, thumb: {kind: 'compare', ref: 'solo-vs-ref'}});
		if (c.canonical === false)
			out.push({...base, check: 'model-component', severity: 'error', key: `${c.key}|component`, message: `${who} carries data-character="${c.kind}" but is not rendered by the canonical asset in src/characters (a copy or fork): CH1 forbids per-scene redraws`, measured: {}, score: 5});
		// requested vs rendered view
		const reqView = c.props && typeof c.props.view === 'string' ? (c.props.view as string) : null;
		const pose = c.props && typeof c.props.pose === 'string' ? (c.props.pose as string) : null;
		const poseForcesView = c.kind === 'badger' && (pose === 'sit' || pose === 'lie' || pose === 'walk' || pose === 'lookUp');
		const typing = c.kind === 'zoo' && (pose === 'typing' || c.pose === 'typing');
		if (reqView && c.view && reqView !== c.view && !poseForcesView && !typing)
			out.push({...base, check: 'model-view', severity: 'warn', key: `${c.key}|view|${reqView}`, message: `${who} was asked for view "${reqView}" but renders "${c.view}" (the asset fell back)`, measured: {requested: reqView, rendered: c.view}, score: 1});
		// Badger's markings against the frozen manifest
		if (c.kind === 'badger') {
			// a drawing the owner has not accepted yet (BADGER_PROVISIONAL_POSES): always a warning, never an error
			const props = c.props ?? {};
			const drawnView = c.view ?? (typeof props.view === 'string' ? props.view : 'left');
			const drawnPose = c.pose ?? (typeof props.pose === 'string' ? props.pose : 'stand');
			const prov = provisionalMatch(manifest.provisional, drawnView, drawnPose);
			if (prov)
				out.push({
					...base,
					check: 'model-provisional',
					severity: 'warn',
					key: `${c.key}|provisional|${prov.view}|${prov.pose}`,
					message: `${who} uses view '${prov.view}' with pose '${prov.pose}', a PROVISIONAL drawing awaiting the owner's OK (${manifest.provisional.decision ? `decision ${manifest.provisional.decision}, ` : ''}BADGER_PROVISIONAL_POSES): fine for review, keep it out of published episodes until the owner accepts it`,
					measured: {view: prov.view, pose: prov.pose, decision: manifest.provisional.decision},
					score: 1,
					thumb: {kind: 'crop'},
				});
			const expected = expectedBadgerBody(manifest, c.view, c.pose);
			if (expected) {
				const body = c.spots.filter((s) => !s.startsWith('H-'));
				const have = new Set(body);
				const want = new Set(expected);
				const missing = expected.filter((s) => !have.has(s));
				const extra = body.filter((s) => !want.has(s));
				const dupes = body.filter((s, k) => body.indexOf(s) !== k);
				if (missing.length || extra.length || dupes.length)
					out.push({
						...base,
						check: 'model-spots',
						severity: 'error',
						key: `${c.key}|spots|${c.view}|${c.pose}`,
						message: `${who} (${c.view}${c.pose && c.pose !== 'stand' ? `, ${c.pose}` : ''}) markings differ from manifest v${manifest.version}: ${[missing.length ? `missing ${missing.join(', ')}` : '', extra.length ? `extra ${extra.join(', ')}` : '', dupes.length ? `duplicated ${dupes.join(', ')}` : ''].filter(Boolean).join('; ')}`,
						measured: {expected: expected.length, found: body.length},
						score: missing.length + extra.length + dupes.length,
						thumb: {kind: 'compare', ref: 'solo-vs-ref'},
					});
			}
		}
	});
	return out;
};

const BANNED_SEVERITY = (kind: string, detail: string): Severity => {
	if (kind === 'css-filter') return /blur\(|drop-shadow\(/.test(detail) ? 'error' : 'warn';
	if (kind === 'svg-filter') return /banned primitives/.test(detail) ? 'error' : 'warn';
	if (kind === 'blend-mode' || kind === 'mask') return 'warn';
	return 'error';
};

export const bannedFindings = (f: FrameFacts): Finding[] =>
	f.banned.map((b) => ({
		check: 'banned',
		severity: BANNED_SEVERITY(b.kind, b.detail),
		frame: f.frame,
		box: b.box,
		subject: b.kind,
		key: `${b.kind}|${b.path}`,
		message: `${b.kind}: ${b.detail} (${b.path}); ART_GUIDE 4 bans gradients, patterns, blur/glow/noise filters and shadows`,
		measured: {kind: b.kind},
		score: b.box.w * b.box.h,
	}));

/** Visible "things" of a frame, for one-frame appearance checks. */
const entities = (f: FrameFacts): Map<string, Rect> => {
	const m = new Map<string, Rect>();
	for (const t of liveTexts(f)) if (t.visibleFrac > 0.2) m.set(`text "${q(t.text, 40)}"`, t.box);
	f.chars.forEach((c, i) => {
		if (c.effects.opacity < T.text.minOpacity) return;
		m.set(`${charLabel(c, i)} view ${c.view}${c.head ? ` / head ${c.head}` : ''}${c.pose ? ` / ${c.pose}` : ''}`, c.headBox ?? c.box);
	});
	return m;
};

/**
 * Something visible in frame t but in neither neighbour (or missing only in t), with both neighbours scouted.
 * Captions are exempt from the "appears" case only when they last one frame by design (never in this project).
 */
export const oneFrameFindings = (facts: Map<number, FrameFacts>): Finding[] => {
	const out: Finding[] = [];
	const frames = [...facts.keys()].sort((a, b) => a - b);
	const ent = new Map<number, Map<string, Rect>>();
	for (const fr of frames) ent.set(fr, entities(facts.get(fr) as FrameFacts));
	for (const t of frames) {
		const prev = ent.get(t - 1);
		const next = ent.get(t + 1);
		const cur = ent.get(t) as Map<string, Rect>;
		if (!prev || !next) continue;
		for (const [k, box] of cur)
			if (!prev.has(k) && !next.has(k))
				out.push({check: 'one-frame-state', severity: 'error', frame: t, box, subject: k, key: `appear|${k}`, message: `${k} is shown for exactly one frame (frame ${t})`, measured: {}, score: 1, thumb: {kind: 'triplet'}});
		for (const [k, box] of prev)
			if (!cur.has(k) && next.has(k))
				out.push({check: 'one-frame-state', severity: 'error', frame: t, box, subject: k, key: `vanish|${k}`, message: `${k} disappears for exactly one frame (frame ${t})`, measured: {}, score: 1, thumb: {kind: 'triplet'}});
	}
	return out;
};
