/**
 * Relative scale and spacing of ZOO and Badger, measured on reference/crops/badger_size_comparison.png
 * (2x crop of the approved Badger sheet). The size-comparison panel controls relative scale
 * (docs/PROJECT_INSTRUCTIONS.md, reference priority). Both characters share world units, so they
 * stand at the correct relative size whenever they are given the SAME `scale` value.
 *
 * Crop measurements (px): ground line y=498 (feet bottom), ZOO hair top y=20 (478 px = 900 units),
 * ZOO sneakers x=68..201 (origin x=134.5), Badger paws x=295..487 (footprint centre x=391).
 */
export const SIZE_COMPARISON = {
	source: 'reference/crops/badger_size_comparison.png',
	zooHeightPx: 478,
	unitsPerPx: 900 / 478, // 1.8828
	zooOriginPx: 134.5,
	badgerOriginPx: 391,
	/** Badger footprint centre sits this many world units to screen right of ZOO's ground point. */
	spacingUnits: Math.round(((391 - 134.5) * 900 * 10) / 478) / 10, // 482.9
	/** Horizontal extent of the pair in world units, relative to ZOO's origin (ZOO hands .. Badger tail tip). */
	pairExtent: {minX: -153, maxX: 720},
	zooHeight: 900,
	badgerWithers: 312.6,
	badgerHeadTop: 451.9,
	badgerEarTop: 455.6,
	badgerBodyLength: 348.3,
	withersToZoo: 0.347,
	headTopToZoo: 0.502,
} as const;
