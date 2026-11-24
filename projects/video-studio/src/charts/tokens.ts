// tokens.ts: chart colour tokens (E7). Two surfaces; the dark slate panel is the default.
export const CHART_DARK = {
	surface: '#161A21', // brand slate
	up: '#45E08F',
	down: '#F0443A',
	flat: '#8B949E', // doji
	grid: '#2A313B',
	axisText: '#9AA3AD',
	ink: '#F4F6F8', // brand off-white: header, glyph labels, signed numbers
	pillText: '#0B0C0F', // text on up/down pills
	volumeUp: '#2B7353', // 45% up mixed over surface, as a flat colour (no opacity)
	volumeDown: '#782D2C', // 45% down mixed over surface
} as const;
export const CHART_LIGHT = {
	surface: '#F4F6F8', // card on the #E6E8EB background
	up: '#17914F',
	down: '#B71C1C',
	flat: '#5B6470',
	grid: '#C4C9D0',
	axisText: '#4A525E',
	ink: '#0B0C0F',
	pillText: '#F4F6F8',
	volumeUp: '#91C9AC',
	volumeDown: '#D99495',
} as const;
export type ChartTokens = typeof CHART_DARK | typeof CHART_LIGHT;
