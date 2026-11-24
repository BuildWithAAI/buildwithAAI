// Config for the audio-only SFX sync check (--config=scripts/audio/sfx/remotion/remotion.config.ts).
// The project config (remotion.config.ts) sets an x264 preset, which Remotion refuses for --codec=wav,
// and a WAV render is what the check needs: AAC would add encoder priming delay to what is measured.
// Same browser choice as the project config: the preinstalled chrome-headless-shell when present.
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
