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
	// Decision ZOO-C2 (2026-11-24): the sheet renders the beard lighter and warmer than the hair
	// (pixel medians: chin #845D40, cheek #77563F, moustache #6A4C34 vs hair #594235), so the beard
	// base is #7A5940 with one shadow tone. Hair keeps #5E4637.
	beard: '#7A5940',
	beardShadow: '#5E4535',
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
	// Added 2026-11-24 (Badger rig): the soft grey brow strokes of the neutral face (sheet samples ~#7A7A7C
	// at the line core). A line colour, not a shadow tone; expressive/judging brows use LINE.color.
	brow: '#8E9299',
	collar: '#393F45',
	collarShadow: '#2B3035',
	tag: BRAND.teal,
	tagShadow: '#1F8E86',
} as const;

/**
 * Story props drawn in the character style (added 2026-11-24 for ZOO's typing pose, decision ZOO-T3).
 * Sampled from the "Sitting at a desk typing" panel of zoo_model_sheet_v1.png: desk ~#C2C3C6,
 * chair ~#5F5F66, monitor bezel ~#67676C / screen ~#4E4E54, keyboard ~#211E21. Each colour has at
 * most one flat shadow tone; the desk uses brand silver.
 */
export const PROP_COLORS = {
	desk: BRAND.silver,
	deskShadow: '#A9AEB6',
	chair: '#5F6067',
	chairShadow: '#48494F',
	chairBase: '#35363A',
	monitor: '#67686E',
	monitorShadow: '#4E4F55', // also the screen face
	keyboard: '#2A2B31',
	keyboardShadow: BRAND.slate,
} as const;
