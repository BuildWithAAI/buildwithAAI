// Config for audio-only renders of the audio integration compositions (--config=src/audio/remotion.wav.config.ts).
// The project config (remotion.config.ts) sets an x264 preset, which Remotion refuses for --codec=wav, and the
// measurements need lossless audio (AAC adds encoder priming and its own peaks). Same browser choice as the project
// config: the preinstalled chrome-headless-shell when present. MP4 renders use the project config as they are.
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
