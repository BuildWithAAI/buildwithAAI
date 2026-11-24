/**
 * Every threshold the checker uses, in one place (recorded in report.json). Values marked "calibrated" were
 * tuned on the clean project compositions (Preview10s, ChartShort, Episode, EpisodeShort) so that they report
 * nothing there, and on the planted-defect fixtures so that each defect is caught; see scripts/qa/README.md.
 */
export const THRESHOLDS = {
	text: {
		/** On-screen text >= 24 px (ART_GUIDE SL10). Sub/superscripts are exempt. */
		minPx: 24,
		/** Below this visible fraction a text node counts as clipped. */
		minVisible: 0.98,
		/** Text sticking into or out of its plate's padding by more than this (px) counts as overflow (warning). */
		overflowPx: 2,
		/** ... and hanging past the plate's outer edge by more than this (px) is an error. */
		offPlatePx: 4,
		/** Text with no plate behind it: exceeding its layout box by more than this many em is information. */
		layoutOverflowEm: 0.25,
		/** Texts fainter than this (ancestor opacity product) are skipped by the geometry checks (fade-in/out). */
		minOpacity: 0.3,
		/** Two texts collide when their ink overlaps by at least this many px² and this share of the smaller text. */
		collisionMinPx: 40,
		collisionFrac: 0.15,
	},
	faces: {
		/** Clear zone around a head: this many head widths (ART_GUIDE CV4c: one head-width). */
		zoneWidths: 1,
		/** A face counts as covered when more than this fraction of its pixels is painted over. */
		occludedFrac: 0.25,
		/** Hands with less than this share visible (hit-tested; e.g. behind a desk) are not checked against the safe area. */
		handVisibleMin: 0.25,
	},
	contrast: {
		/** WCAG 2.x AA for body text; the project minimum for all on-screen text (src/thumbnails/contrast.ts). */
		min: 4.5,
		/** Only measured when the text is this opaque (ancestor opacity product); fades are skipped. */
		minOpacity: 0.95,
		/** Glyph pixels: |with text - without text| (max channel) at least this. */
		glyphDiff: 16,
		/** Percentile of the per-pixel contrasts reported (robust against anti-aliasing). Calibrated. */
		percentile: 20,
	},
	model: {
		/** Uniform-scale tolerance: |sx/sy - 1| above this = stretched. */
		anisotropy: 0.02,
		/** Skew or rotation of the whole character above this (degrees). */
		angleDeg: 1,
		/** Canonical-render comparison (calibrated: clean scenes measure SSIM 1.0000 and 0 changed pixels). */
		ssimError: 0.97,
		ssimWarn: 0.995,
		/** A pixel "changed" when its max channel difference exceeds this. */
		changedLevel: 40,
		/** Changed pixels above this fraction of the character = error. */
		changedFracError: 0.01,
		changedFracWarn: 0.002,
		/** Interior pixels whose colour is more than this ΔE76 from every palette colour are off-palette. */
		paletteDeltaE: 6,
		/** Off-palette interior pixels above this fraction = error. */
		paletteFracError: 0.01,
		/** Characters fainter than this (fade) are not compared pixel by pixel. */
		minOpacity: 0.98,
		/**
		 * A character below this opacity means a cross-fade is under way (characters are opaque outside
		 * transitions): the frame gets only the flicker test. The last frame of an eased fade is at about 0.985.
		 */
		crossFadeOpacity: 0.999,
		/** Pin / ear-cap blob position tolerance vs the canonical render, in character units (Zoo = 900 tall). */
		blobTolUnits: 12,
	},
	gradient: {
		/** A 32x32 block is a gradient block when its best-fit plane changes at least this many levels ... */
		minBlockChange: 0.6,
		/** ... with an RMS residual at most this (or 15% of the change: dither and noise) ... */
		maxResidual: 0.8,
		/** ... and no neighbour step above this (an edge between flat fills has larger steps). */
		maxStep: 4,
		/** Regions of at least this many gradient blocks ... */
		minBlocks: 4,
		/** ... changing at least this many luma levels in total are reported. */
		minChange: 4,
		/** Regions darker than this L* band worst after compression (ART_GUIDE N2): error. */
		darkLstar: 35,
		/** Regions covering more than this fraction of the frame: error. */
		largeFrac: 0.04,
	},
	texture: {
		/** 16x16 block: fraction of pixels within ±2 levels of the block's 4 most common luma values. */
		flatFrac: 0.82,
		/** Pixels with a neighbour step above this are edges; texture blocks have few strong edges. */
		edgeStep: 24,
		maxEdgeFrac: 0.35,
		/** Regions of at least this many texture blocks are reported. */
		minBlocks: 12,
	},
	flicker: {
		/** A pixel pops when frame t differs from both neighbours by more than this (max channel) ... */
		diff: 24,
		/** ... while the neighbours agree within this. */
		back: 8,
		/** Pop regions at least this large (px) are reported. */
		minArea: 64,
		/** Whole-frame mean luma difference for a flash. */
		flashLuma: 10,
		/** Motion, not flicker: around a pop the neighbours differ in at least this multiple of the pop's area. */
		motionRatio: 0.5,
		/**
		 * Motion-compensated test: a pop region whose content is found in a neighbour, displaced by up to this share
		 * of the frame's longer side, is motion (a card dropping in, a slide), not a one-frame state.
		 */
		searchFrac: 0.3,
		/** Context around the changed pixels that must match too (px), so a shape matches only with its surroundings. */
		contextPx: 6,
		/** Pop fragments up to this many 4 px cells apart form one region (glyph pieces join into words and lines). */
		mergeCells: 2,
		/** A head or hand whose box moves at least this much (px) across the triplet is animating, not flickering. */
		partMovePx: 4,
		/** Found = at least this share of the region's pixels, and of its changed pixels, match (3x3 envelope ±12 levels). */
		matchShare: 0.8,
		/**
		 * ... or this share at a displacement corroborated elsewhere (the probe saw a text or character move by it, or
		 * the frame's popped content as a whole moved by it): moving content passes under static overlays.
		 */
		corroboratedShare: 0.65,
		/** Found in both neighbours at the same displacement (an element jumps away for one frame and returns): flicker from this many px. */
		jumpPx: 3,
		/** ... when the neighbours themselves agree on at least this share of the region (the element did not travel). */
		jumpAgree: 0.97,
	},
	scout: {
		/** A cut: at least this fraction of pixels change by more than 16 levels (1/8-scale frames). */
		cutChanged: 0.3,
		/**
		 * A slide or push transition: at least this changed fraction for at least `motionSpanFrames` consecutive
		 * frames (calibrated on the episode fixture: transitions hold 5-16% for 6-17 frames, element entrances
		 * peak under 5% for 1-3 frames).
		 */
		motionSpanChanged: 0.05,
		/** ... and continues while the changed fraction stays at or above this (hysteresis). */
		motionSpanHold: 0.015,
		motionSpanFrames: 4,
		/** Low-resolution pop candidates (verified at full size before anything is reported). */
		popDiff: 12,
		popBack: 5,
		popMinPx: 2,
	},
} as const;

export type Thresholds = typeof THRESHOLDS;
