/**
 * Branding kit: spec, colour, geometry, layout and timing tests (pure modules; no browser).
 * Run all branding tests: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/branding/tests/run.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {AVATAR, BANNER, bannerCropRect, bannerSafeRect, centred, contains, END_SCREEN, inset, STING, TEXT_LIMITS, union, WATERMARK} from '../spec.ts';
import {contrast, hexToRgb, lightness, luminance} from '../color.ts';
import {BRAND, ZOO_COLORS} from '../../characters/palette.ts';
import {BACKGROUND_SHADOW, SHOW, ZOORA} from '../tokens.ts';
import {ACCENT_DOT_R, BOUNDS, CENTRE, CUSPS_X, NODE_R, NODES, STROKE, TRACES} from '../marks/jellyfishGeometry.ts';
import {BADGER_HEAD, placeBox, ZOO_HEAD} from '../characterFrames.ts';
import {
	AVATAR_FRAMING,
	BADGE,
	END_LAYOUT,
	END_SCREEN_FRAMES,
	END_ZONES,
	SHOW_BANNER,
	SHOW_STING_BEATS,
	showBannerHeads,
	STING_HITS,
	WORDMARK_INK,
	ZOORA_BANNER,
	ZOORA_LOCKUP,
	ZOORA_STING_BEATS,
	ZOORA_STING_LAYOUT,
	zooraBannerHeads,
} from '../layout.ts';
import {blinkAt, blinkCurve, blinkStarts, minJerk, progress} from '../motion.ts';
import {LAYOUTS} from '../../episode/layout/specs.ts';

// ---------- spec ----------
test('spec: the 1546x423 safe area is centred on 2560x1440 and matches the official minimum-size safe area x1.25', () => {
	const s = bannerSafeRect();
	assert.deepEqual(s, {x: 507, y: 508.5, w: 1546, h: 423});
	// answer/10456525: 1235x338 at 2048x1152; scaled to 2560 that is 1543.75 x 422.5 (the template rounds to 1546 x 423)
	const k = BANNER.width / BANNER.minUpload.width;
	assert.ok(Math.abs(BANNER.minSafe.width * k - BANNER.safe.width) <= 3);
	assert.ok(Math.abs(BANNER.minSafe.height * k - BANNER.safe.height) <= 1);
	assert.equal(BANNER.width / BANNER.height, 16 / 9);
});

test('spec: every device crop contains the safe area, and the crops nest phone < tablet < desktop < tv', () => {
	const safe = bannerSafeRect();
	const order = ['phone', 'tablet', 'desktop', 'tv'] as const;
	for (const c of order) assert.ok(contains(bannerCropRect(c), safe), c);
	for (let i = 1; i < order.length; i++) assert.ok(contains(bannerCropRect(order[i]), bannerCropRect(order[i - 1])), order[i]);
});

test('spec: limits read from YouTube Help / Data API on 2026-11-24', () => {
	assert.equal(BANNER.maxBytes, 6_000_000);
	assert.equal(AVATAR.display, 98);
	assert.equal(AVATAR.maxBytes, 15_000_000);
	assert.deepEqual([WATERMARK.width, WATERMARK.height, WATERMARK.maxBytesExclusive], [150, 150, 1_000_000]);
	assert.deepEqual([END_SCREEN.minSec, END_SCREEN.maxSec, END_SCREEN.minVideoSec, END_SCREEN.maxElements], [5, 20, 25, 4]);
	assert.deepEqual([TEXT_LIMITS.channelDescription, TEXT_LIMITS.channelKeywordsTotal], [1000, 500]);
	assert.deepEqual([STING.minSec, STING.maxSec, STING.width, STING.height, STING.fps], [3, 5, 1920, 1080, 30]);
});

test('spec: rect helpers', () => {
	assert.deepEqual(centred({width: 10, height: 10}, {width: 4, height: 2}), {x: 3, y: 4, w: 4, h: 2});
	assert.deepEqual(inset({x: 0, y: 0, w: 10, h: 10}, 2), {x: 2, y: 2, w: 6, h: 6});
	assert.deepEqual(union([{x: 0, y: 0, w: 1, h: 1}, {x: 5, y: -2, w: 1, h: 1}]), {x: 0, y: -2, w: 6, h: 3});
	assert.ok(contains({x: 0, y: 0, w: 10, h: 10}, {x: 0, y: 0, w: 10, h: 10}));
	assert.ok(!contains({x: 0, y: 0, w: 10, h: 10}, {x: 0, y: 0, w: 10.5, h: 10}));
});

// ---------- colour ----------
test('colour: WCAG contrast and CIE L* match known values', () => {
	assert.equal(contrast('#000000', '#FFFFFF').toFixed(1), '21.0');
	assert.equal(contrast('#777777', '#777777'), 1);
	assert.ok(Math.abs(luminance(hexToRgb('#FFFFFF')) - 1) < 1e-9);
	assert.throws(() => hexToRgb('#12345'), /RRGGBB/);
	// ART_GUIDE CV4 (measured P1): background 91.9, off-white 96.8, teal 67.8, overshirt 23.7
	assert.ok(Math.abs(lightness(BRAND.background) - 91.9) < 0.15);
	assert.ok(Math.abs(lightness(BRAND.offWhite) - 96.8) < 0.15);
	assert.ok(Math.abs(lightness(BRAND.teal) - 67.8) < 0.15);
	assert.ok(Math.abs(lightness(ZOO_COLORS.overshirt) - 23.7) < 0.15);
});

test('colour: every text and line pairing in the kit clears WCAG AA (4.5:1 text, 3:1 large text and graphics)', () => {
	const text: Array<[string, string, string]> = [
		['Zoora wordmark on black', ZOORA.text, ZOORA.bg],
		['Zoora tagline (silver) on black', ZOORA.textMuted, ZOORA.bg],
		['show logo on the slate plate', SHOW.onPlate, SHOW.plate],
		['show "The"/"Show" (silver) on slate', SHOW.onPlateMuted, SHOW.plate],
		['show tagline on the light set', SHOW.ink, SHOW.bg],
		['dark badge label', BRAND.offWhite, BRAND.slate],
		['light badge label', BRAND.nearBlack, BRAND.offWhite],
	];
	for (const [what, fg, bg] of text) assert.ok(contrast(fg, bg) >= 4.5, `${what}: ${contrast(fg, bg).toFixed(2)}`);
	// large text and graphics (3:1): the teal ampersand at >= 92 px bold, the silver jellyfish, the porthole on black
	assert.ok(contrast(SHOW.accent, SHOW.plate) >= 3, 'teal ampersand on slate');
	assert.ok(contrast(ZOORA.line, ZOORA.bg) >= 3, 'silver line art on black');
	assert.ok(contrast(ZOORA.stage, ZOORA.bg) >= 3, 'light porthole on black');
});

test('colour: Badger avatar ground keeps both the white face and the dark ear readable (L*)', () => {
	const ground = lightness(SHOW.line); // silver
	assert.ok(lightness(BRAND.offWhite) - ground >= 8, 'coat vs ground');
	assert.ok(ground - lightness('#19191C') >= 40, 'dark ear cap vs ground');
	// slate would lose the dark ear (the reason the avatar is not on slate)
	assert.ok(lightness(BRAND.slate) - lightness('#19191C') < 10);
	assert.equal(BACKGROUND_SHADOW, '#CFD3D8');
});

// ---------- jellyfish mark ----------
test('mark: three tentacles root at the rim cusps and end in ring nodes inside the bounds', () => {
	assert.equal(TRACES.length, 3);
	assert.deepEqual(TRACES.map((t) => t[0][0]), [...CUSPS_X]);
	for (const t of TRACES) assert.equal(t[0][1], 0, 'traces start on the cusp line');
	for (const [i, n] of NODES.entries()) {
		const last = TRACES[i][TRACES[i].length - 1];
		assert.equal(n.x, last[0]);
		assert.equal(n.y, last[1] + NODE_R, 'the trace meets the top of its ring');
		assert.ok(n.x - n.r - STROKE / 2 >= BOUNDS.x - 1e-9 && n.x + n.r + STROKE / 2 <= BOUNDS.x + BOUNDS.w + 1e-9);
	}
	assert.ok(ACCENT_DOT_R > 0 && ACCENT_DOT_R < NODE_R, 'the accent dot fills the ring hole');
	assert.ok(Math.abs(CENTRE[0]) < 1e-9, 'symmetric mark is centred on x = 0');
});

test('mark: the line stays >= 3 px at the 98 px avatar and >= 1.5 px at a 36 px comment avatar', () => {
	const line800 = STROKE * (AVATAR_FRAMING.mark.height / BOUNDS.h) + AVATAR_FRAMING.mark.strokeBoostPx;
	const at = (avatarPx: number) => (line800 * avatarPx) / AVATAR.width;
	assert.ok(at(98) >= 3, `${at(98).toFixed(2)} px at 98`);
	assert.ok(at(36) >= 1.5, `${at(36).toFixed(2)} px at 36`);
	// the ring holes stay open at 98 px (>= 1 px)
	const k = AVATAR_FRAMING.mark.height / BOUNDS.h;
	const hole = (2 * (NODE_R * k - line800 / 2) * 98) / AVATAR.width;
	assert.ok(hole >= 1, `${hole.toFixed(2)} px hole`);
});

// ---------- avatar framing ----------
test('avatar: subjects are framed inside the circle crop (geometry; the QA run checks the pixels)', () => {
	const r = AVATAR.width / 2;
	// the mark: its farthest point (a side node's outer edge) from the canvas centre
	const k = AVATAR_FRAMING.mark.height / BOUNDS.h;
	const cx = r;
	const cy = AVATAR_FRAMING.mark.cy;
	const far = Math.max(
		...NODES.map((n) => Math.hypot((n.x - CENTRE[0]) * k + cx - r, (n.y - CENTRE[1]) * k + cy - r) + (n.r + STROKE / 2) * k),
		Math.hypot(0, (BOUNDS.y - CENTRE[1]) * k + cy - r),
	);
	assert.ok(far <= 0.86 * r, `mark reaches ${(far / r).toFixed(3)} r`);
	// Badger: the head box corners (ears) stay inside the circle
	const b = AVATAR_FRAMING.badger;
	const head = placeBox(BADGER_HEAD, 0, 0, b.scale);
	const corners = [
		[head.x, head.y + head.h * 0.3],
		[head.x + head.w, head.y + head.h * 0.3],
	].map(([x, y]) => [x - (head.x + head.w / 2) + b.headCentre.x, y - (head.y + head.h / 2) + b.headCentre.y]);
	for (const [x, y] of corners) assert.ok(Math.hypot(x - r, y - r) <= 0.95 * r, `ear at ${x.toFixed(0)},${y.toFixed(0)}`);
});

// ---------- banners ----------
test('banners: every head box sits inside the safe area with a 16 px margin', () => {
	const safe = inset(bannerSafeRect(), 16);
	for (const [name, heads] of [
		['zoora', zooraBannerHeads()],
		['show', showBannerHeads()],
	] as const) {
		for (const h of heads) assert.ok(contains(safe, h), `${name}: ${JSON.stringify(h)}`);
	}
});

test('banners: Zoora porthole holds both full figures; the wordmark clears the porthole', () => {
	const P = ZOORA_BANNER.portal;
	const p = ZOORA_BANNER.pair;
	const zooTop = p.groundY + ZOO_HEAD.y * p.scale;
	for (const [x, y] of [
		[p.zooX, zooTop],
		[p.zooX - 60, p.groundY],
		[p.badgerX + 45, p.groundY],
	]) {
		assert.ok(Math.hypot(x - P.cx, y - P.cy) < P.r, `point ${x},${y} inside the porthole`);
	}
	// lockup right edge (mark + gap + measured wordmark) vs the porthole's left edge at the wordmark's height
	const s = ZOORA_BANNER.lockup.scale;
	const markW = (ZOORA_LOCKUP.markHeight * s * BOUNDS.w) / BOUNDS.h;
	const right = ZOORA_BANNER.lockup.x + markW + ZOORA_LOCKUP.gap * s + (WORDMARK_INK.left + WORDMARK_INK.width) * ZOORA_LOCKUP.word * s;
	const portalLeft = P.cx - Math.sqrt(P.r ** 2 - (ZOORA_BANNER.lockup.y - 40 - P.cy) ** 2);
	assert.ok(portalLeft - right >= 40, `gap ${Math.round(portalLeft - right)} px`);
});

test('banners: show set keeps Badger in front of the monitor and both characters cut by the desk', () => {
	const L = SHOW_BANNER;
	const [zoo, badger] = showBannerHeads();
	const M = L.monitor;
	assert.ok(badger.x >= M.x && badger.x + badger.w * 0.8 <= M.x + M.w && badger.y >= M.y, 'Badger head over the slate monitor (CV4a)');
	assert.ok(zoo.x + zoo.w <= M.x, "Zoo's head is in front of the light wall, not the monitor (CV4b)");
	// the desk top crosses Zoo at hip height (about -470 units) and Badger at the chest (below his tag at -266)
	const zooAtDesk = (L.deskTop - L.zoo.groundY) / L.scale;
	const badgerAtDesk = (L.deskTop - L.badger.groundY) / L.scale;
	assert.ok(zooAtDesk > -520 && zooAtDesk < -420, `Zoo cut at ${zooAtDesk}`);
	assert.ok(badgerAtDesk > -266 && badgerAtDesk < -180, `Badger cut at ${badgerAtDesk}`);
});

// ---------- end screen ----------
test('end screen: zones are identical to the episode engine (one Studio end-screen layout fits every video)', () => {
	const E = LAYOUTS.endscreen.landscape;
	assert.deepEqual(END_ZONES.slots.map((z) => ({...z})), E.slots.map((z) => ({...z})));
	assert.deepEqual({...END_ZONES.subscribe}, {...E.subscribe});
	assert.equal(END_SCREEN_FRAMES, 20 * 30);
	// two video zones + subscribe = 3 of YouTube's 4 elements; the zones never overlap each other
	const [a, b] = END_ZONES.slots;
	assert.ok(a.y + a.h <= b.y);
	const S = END_ZONES.subscribe;
	assert.ok(S.cx + S.r <= a.x, 'subscribe circle left of the video zones');
	// the Zoora porthole stays left of the subscribe circle
	const P = END_LAYOUT['zoora-ai'].portal;
	assert.ok(P.cx + P.r + 8 <= S.cx - S.r);
});

// ---------- badges ----------
test('badges: proportions read at a 320 px thumbnail (label >= 10 px) and leave the duration corner free', () => {
	const scale = 320 / 1280;
	assert.ok(BADGE.height * BADGE.text * scale >= 10);
	assert.ok(BADGE.icon * BADGE.height >= 48, 'icon >= 48 px on the 1280 canvas');
});

// ---------- stings ----------
test('stings: beats are ordered, the Zoora settle finishes before the name wipes, and hits survive the 3 s minimum', () => {
	const B = ZOORA_STING_BEATS;
	for (const k of ['bell', 'inner', 'traces', 'nodes', 'settle', 'word', 'tag', 'background'] as const) assert.ok(B[k][0] < B[k][1], k);
	assert.ok(B.bell[0] < B.traces[0] && B.traces[0] < B.nodes[0] && B.nodes[0] <= B.hit);
	assert.ok(B.settle[1] <= B.word[0] + 2, 'the mark has settled before the wordmark wipes in');
	const S = SHOW_STING_BEATS;
	assert.ok(S.plate[0] < S.main[0] && S.main[1] <= S.hit1 && S.hit1 < S.hit2);
	const minFrames = 3 * 30;
	for (const hits of Object.values(STING_HITS)) for (const h of hits) assert.ok(h.frame < minFrames - B.fadeFrames, `hit at ${h.frame}`);
	// the final lockup is optically centred on 960 (mark + gap + measured ink)
	const L = ZOORA_STING_LAYOUT;
	const left = L.markEnd.cx - (L.markEnd.h * BOUNDS.w) / BOUNDS.h / 2;
	const right = L.word.left + (WORDMARK_INK.left + WORDMARK_INK.width) * L.word.size;
	assert.ok(Math.abs((left + right) / 2 - 960) < 2, `centre ${((left + right) / 2).toFixed(1)}`);
});

// ---------- motion ----------
test('motion: blink shape and seeded schedule follow ART_GUIDE LP6/LP7', () => {
	assert.equal(blinkCurve(0), 0);
	assert.equal(blinkCurve(2), 1);
	assert.equal(blinkCurve(3), 1);
	assert.equal(blinkCurve(7), 0);
	assert.ok(blinkCurve(1) < 0.5 && blinkCurve(5) > 0 && blinkCurve(5) < 0.5, 'closes faster than it opens');
	const s = blinkStarts('test', 3000);
	assert.deepEqual(s, blinkStarts('test', 3000), 'deterministic');
	for (let i = 1; i < s.length; i++) assert.ok(s[i] - s[i - 1] >= 45 && s[i] - s[i - 1] <= 150);
	assert.equal(blinkAt(s[0] + 2, s), 1);
	assert.equal(minJerk(0), 0);
	assert.equal(minJerk(1), 1);
	assert.equal(minJerk(0.5), 0.5);
	assert.equal(progress(5, 0, 10, (t) => t), 0.5);
	assert.equal(progress(-5, 0, 10), 0);
	assert.equal(progress(50, 0, 10), 1);
});
