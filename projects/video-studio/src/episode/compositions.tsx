/**
 * Episode + EpisodeShort compositions (episode entry: src/episode/index.ts).
 *   npx remotion render src/episode/index.ts Episode out/episodes/<slug>/<lang>/episode.mp4 --props='{"channel":"zoora-ai","slug":"<slug>","lang":"en"}'
 *   npx remotion render src/episode/index.ts EpisodeShort out/episodes/<slug>/<lang>/<shortId>.mp4 --props='{"channel":"zoora-ai","slug":"<slug>","lang":"en","shortId":"<id>"}'
 * Props: {channel, slug, lang, shortId?, captions?, timelineOverride?}. calculateMetadata loads the storyboard and the
 * timeline, validates them (errors fail before frame 0), resolves the charts and sets durationInFrames from the
 * timeline. The defaults render the dev fixture (channel "_dev") with a mock timeline: a silent, badged preview.
 */
import React from 'react';
import {Composition, type CalculateMetadataFunction} from 'remotion';
import {EpisodeView} from './Episode';
import {resolveEpisode, FPS, type EpisodeProps} from './load';
import {FRAME, type Format} from './layout/specs';

const DEFAULTS: EpisodeProps = {channel: '_dev', slug: 'engine-demo', lang: 'en'};

const calc =
	(format: Format): CalculateMetadataFunction<EpisodeProps> =>
	async ({props, abortSignal}) => {
		const {resolved: _ignored, ...input} = props;
		void _ignored;
		const resolved = await resolveEpisode(input, format, abortSignal);
		const name = format === 'vertical' ? `${input.slug}-${input.lang}-${resolved.shortId}` : `${input.slug}-${input.lang}`;
		return {durationInFrames: resolved.durationInFrames, fps: FPS, props: {...input, resolved}, defaultOutName: name};
	};

export const EpisodeCompositions: React.FC = () => (
	<>
		<Composition
			id="Episode"
			component={EpisodeView}
			width={FRAME.landscape.width}
			height={FRAME.landscape.height}
			fps={FPS}
			durationInFrames={FPS * 10}
			defaultProps={DEFAULTS}
			calculateMetadata={calc('landscape')}
		/>
		<Composition
			id="EpisodeShort"
			component={EpisodeView}
			width={FRAME.vertical.width}
			height={FRAME.vertical.height}
			fps={FPS}
			durationInFrames={FPS * 10}
			defaultProps={DEFAULTS}
			calculateMetadata={calc('vertical')}
		/>
	</>
);
