import {loadFont} from '@remotion/fonts';
// OFL-1.1 fonts bundled from npm (@fontsource/*). Nothing is fetched from Google at render time.
import anton400 from '@fontsource/anton/files/anton-latin-400-normal.woff2';
import inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff2';
import inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff2';
import inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff2';
import inter800 from '@fontsource/inter/files/inter-latin-800-normal.woff2';
import inter900 from '@fontsource/inter/files/inter-latin-900-normal.woff2';
import mont700 from '@fontsource/montserrat/files/montserrat-latin-700-normal.woff2';
import mont800 from '@fontsource/montserrat/files/montserrat-latin-800-normal.woff2';
import mont900 from '@fontsource/montserrat/files/montserrat-latin-900-normal.woff2';

export const FONTS = {
	display: 'Anton', // thumbnail headlines, big kinetic words (single weight 400)
	heading: 'Montserrat', // 700/800/900
	body: 'Inter', // captions, UI, lower thirds: 400-900
} as const;

const faces: Array<{family: string; url: string; weight: string}> = [
	{family: 'Anton', url: anton400, weight: '400'},
	{family: 'Inter', url: inter400, weight: '400'},
	{family: 'Inter', url: inter600, weight: '600'},
	{family: 'Inter', url: inter700, weight: '700'},
	{family: 'Inter', url: inter800, weight: '800'},
	{family: 'Inter', url: inter900, weight: '900'},
	{family: 'Montserrat', url: mont700, weight: '700'},
	{family: 'Montserrat', url: mont800, weight: '800'},
	{family: 'Montserrat', url: mont900, weight: '900'},
];

// loadFont blocks rendering until each face is ready and fails the render if one fails.
let loaded: Promise<void> | null = null;
export const loadBrandFonts = (): Promise<void> => {
	if (!loaded) {
		loaded = Promise.all(faces.map((f) => loadFont({family: f.family, url: f.url, weight: f.weight, format: 'woff2'}))).then(() => undefined);
	}
	return loaded;
};
loadBrandFonts();
