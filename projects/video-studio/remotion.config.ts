import {Config} from '@remotion/cli/config';
import {existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

// Cloud sessions cannot download Remotion's own browser (remotion.media is blocked).
// Use the preinstalled Playwright chrome-headless-shell when present; elsewhere
// (e.g. a local machine) leave it unset so Remotion uses its bundled browser.
const PW_ROOT = '/opt/pw-browsers';
const findHeadlessShell = (): string | null => {
	if (!existsSync(PW_ROOT)) return null;
	const dir = readdirSync(PW_ROOT)
		.filter((d) => /^chromium_headless_shell-\d+$/.test(d))
		.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0];
	if (!dir) return null;
	const bin = join(PW_ROOT, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
	return existsSync(bin) ? bin : null;
};

const browser = process.env.REMOTION_BROWSER_EXECUTABLE ?? findHeadlessShell();
if (browser) Config.setBrowserExecutable(browser);

// PNG frames: JPEG q80 frames measured 35.69 dB vs 40.00 dB after H.264, at the same wall time (docs/ART_GUIDE.md EN1).
Config.setVideoImageFormat('png');
// Near-lossless master for YouTube's re-encode; 'slow' costs ~nothing because frame capture is the bottleneck (EN2).
Config.setCrf(12);
Config.setX264Preset('slow');
// YouTube-friendly output: limited-range 4:2:0, BT.709 colour metadata.
Config.setPixelFormat('yuv420p');
Config.setColorSpace('bt709');
Config.setOverwriteOutput(true);
Config.setConcurrency(Number(process.env.REMOTION_CONCURRENCY ?? 3));
