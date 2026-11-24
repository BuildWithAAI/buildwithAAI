/**
 * End-to-end sync proof for the SFX library: places library files with the TS helper (startFrame)
 * so each sync point should land on a planned frame, for Remotion's own audio mixer to render.
 * scripts/audio/sfx/sync_check.py renders it (audio only) and measures where every attack and
 * pass-by actually lands. A separate entry point (scripts/audio/sfx/remotion/index.ts): never
 * registered in src/Root.tsx.
 */
import React from 'react';
import {AbsoluteFill, Composition, Html5Audio, Sequence, staticFile} from 'remotion';
import manifest from '../../../../public/audio/sfx/manifest.json';
import {asManifest, durationInFrames, sfx, startFrame} from '../sfx.ts';

const lib = asManifest(manifest);

/** [sound id, the frame its sync point must land on]. Spaced so the files do not overlap. */
export const SYNC_PLAN: ReadonlyArray<readonly [string, number]> = [
	['key_01', 10],
	['key_space_02', 20],
	['mouse_click_01', 30],
	['pop_01', 45],
	['tick_02', 55],
	['whoosh_medium_02', 75],
	['badger_tail_02', 100],
	['mug_03', 125],
];

export const SYNC_CHECK_FRAMES = 150;

const SyncCheck: React.FC = () => (
	<AbsoluteFill style={{backgroundColor: '#E6E8EB'}}>
		{SYNC_PLAN.map(([id, frame]) => {
			const e = sfx(lib, id);
			return (
				<Sequence key={id} name={id} from={startFrame(e, frame)} durationInFrames={durationInFrames(e)}>
					<Html5Audio src={staticFile(e.file)} />
				</Sequence>
			);
		})}
	</AbsoluteFill>
);

export const SfxRoot: React.FC = () => (
	<Composition id="SfxSyncCheck" component={SyncCheck} durationInFrames={SYNC_CHECK_FRAMES} fps={30} width={320} height={180} />
);
