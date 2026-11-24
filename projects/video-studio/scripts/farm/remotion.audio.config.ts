/**
 * Remotion settings for the farm's audio-only jobs (kind "audio": a dub's full mix as one audio file). The studio's
 * remotion.config.ts sets an x264 preset and a CRF for its video masters, and Remotion refuses an x264 preset with an
 * audio codec, so audio jobs pass --config=scripts/farm/remotion.audio.config.ts instead. It keeps the same browser
 * choice and concurrency; nothing else in the studio config affects audio.
 */
import {Config} from '@remotion/cli/config';
import {existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

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
Config.setOverwriteOutput(true);
Config.setConcurrency(Number(process.env.REMOTION_CONCURRENCY ?? 3));
