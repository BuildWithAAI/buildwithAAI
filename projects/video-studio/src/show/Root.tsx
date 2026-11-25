/**
 * "The Zoo & Badger Show" compositions (entry: src/show/index.ts; not src/Root.tsx, not src/episode/Root.tsx).
 *   npx remotion render src/show/index.ts ShowEpisode out/show/<slug>/<lang>/episode.mp4 --props='{"channel":"zoora-security","slug":"<slug>","lang":"en"}'
 *   npx remotion render src/show/index.ts ShowShort out/show/<slug>/<lang>/<shortId>.mp4 --props='{"channel":"zoora-security","slug":"<slug>","lang":"en","shortId":"<id>"}'
 * Props: {channel, slug, lang, shortId?, captions?, channelName?, timelineOverride?}. calculateMetadata loads and
 * validates the storyboard and the timeline (errors fail before frame 0) and sets the duration from the timeline.
 * The defaults render the dev fixture (channel "_dev") on a mock timeline: a silent, badged preview.
 */
import React from 'react';
import {Composition, type CalculateMetadataFunction} from 'remotion';
import {ShowView} from './Show';
import {FPS, resolveShow, type ShowProps} from './load';
import {FRAME} from './layout/shots';
import type {Format} from './types';

// No channelName: Remotion spreads these defaults under every render's input props, so a null here would hide the
// name on zoora-security renders that omit it. Omitted, _dev still gets none (channel.ts).
export const SHOW_DEFAULTS: ShowProps = {channel: '_dev', slug: 'zoo-badger-demo', lang: 'en'};

const calc =
	(format: Format): CalculateMetadataFunction<ShowProps> =>
	async ({props, abortSignal}) => {
		const {resolved: _ignored, ...input} = props;
		void _ignored;
		const resolved = await resolveShow(input, format, abortSignal);
		const name = format === 'vertical' ? `${input.slug}-${input.lang}-${resolved.shortId}` : `${input.slug}-${input.lang}`;
		return {durationInFrames: resolved.durationInFrames, fps: FPS, props: {...input, resolved}, defaultOutName: name};
	};

export const ShowRoot: React.FC = () => (
	<>
		<Composition
			id="ShowEpisode"
			component={ShowView}
			width={FRAME.landscape.width}
			height={FRAME.landscape.height}
			fps={FPS}
			durationInFrames={FPS * 10}
			defaultProps={SHOW_DEFAULTS}
			calculateMetadata={calc('landscape')}
		/>
		<Composition
			id="ShowShort"
			component={ShowView}
			width={FRAME.vertical.width}
			height={FRAME.vertical.height}
			fps={FPS}
			durationInFrames={FPS * 10}
			defaultProps={SHOW_DEFAULTS}
			calculateMetadata={calc('vertical')}
		/>
	</>
);
