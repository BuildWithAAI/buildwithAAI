/**
 * Zoora AI character palette, v1 (2026-11-24).
 * Brand tokens come from docs/PROJECT_INSTRUCTIONS.md (binding). Character colours were
 * sampled from the approved model sheets in reference/model-sheets/*_v1.png
 * (median-cut quantisation of the front views).
 * Rule: solid fills only, at most ONE flat shadow tone per colour. No gradients, filters or patterns.
 */
export const BRAND = {
	nearBlack: '#0B0C0F',
	slate: '#161A21',
	silver: '#C9CED6',
	offWhite: '#F4F6F8',
	teal: '#29B8AD', // the single decorative accent; use sparingly
	background: '#E6E8EB', // default scene background (flat light grey)
} as const;

/** Outline colour and width for BOTH characters (world units at scale 1). */
export const LINE = {
	color: BRAND.nearBlack,
	width: 3.5,
	detailWidth: 2.25, // interior details: seams, fingers, brows
} as const;

/**
 * ZOO. Decision ZOO-C1: Prompt 1 calls the overshirt "slate", and the approved drawing renders it
 * as #37383F, clearly lighter than the near-black tee. The drawing defines garments, so the overshirt
 * base is #37383F (sampled) with one shadow tone. Tee, trousers and outline use near-black tokens.
 */
export const ZOO_COLORS = {
	skin: '#F3BE9B',
	skinShadow: '#DDA27F',
	hair: '#5E4637',
	hairShadow: '#443329',
	beard: '#5E4637',
	beardShadow: '#443329',
	eyeIris: '#5A3E2B', // brown
	eyeWhite: '#FFFFFF',
	pupil: BRAND.nearBlack,
	brow: '#3A2A20',
	mouthInterior: '#5A2A24',
	tongue: '#B8635A',
	teeth: '#FFFFFF',
	overshirt: '#37383F',
	overshirtShadow: '#2A2B31',
	buttons: '#C9CED6', // small silver buttons (brand silver)
	tee: '#1A1A1D',
	trousers: '#202022',
	trousersShadow: '#141416',
	sneaker: '#E7E9EC',
	sneakerShadow: '#C9CED6',
	sneakerSole: '#F4F6F8',
	pin: BRAND.teal, // tiny jellyfish pin, anatomical LEFT chest
} as const;

/** BADGER. Spots are near-black. Sampled collar is #393F45; the tag is the brand teal. */
export const BADGER_COLORS = {
	coat: BRAND.offWhite,
	coatShadow: '#D9DCE0',
	spot: '#19191C',
	earCap: '#19191C', // dark cap on anatomical LEFT ear
	earPale: '#E9E4E0',
	earPaleInner: '#C9B8B0',
	nose: '#19191C',
	eyeIris: '#6B4A33', // warm brown
	eyeWhite: '#FFFFFF',
	pupil: BRAND.nearBlack,
	mouth: '#3A2A28',
	tongue: '#C97A72',
	collar: '#393F45',
	collarShadow: '#2B3035',
	tag: BRAND.teal,
	tagShadow: '#1F8E86',
} as const;
