/**
 * Thumbnail still (episode entry: src/episode/index.ts). 1280x720 PNG, 3 variants per episode per language, made for
 * YouTube "Test & Compare".
 *   node scripts/thumbnails.ts <channel>/<slug> --lang <lang>     renders v0..v2, checks size, contrast and legibility
 *   npx remotion still src/episode/index.ts Thumbnail out/thumbnails/<slug>/<lang>/v0.png --image-format=png \
 *     --props='{"channel":"zoora-ai","slug":"<slug>","lang":"en","variant":0}'
 * Props: {channel, slug, lang, variant: 0|1|2} (the thumbnail id, e.g. "a", also works: the publish kit passes it).
 * calculateMetadata loads storyboard.json (expression, badger) and, for
 * lang != en, storyboard.<lang>.json (the translated text), validates them and fails before the frame is drawn.
 * The defaults render the dev fixture (channel "_dev").
 */
import React from 'react';
import {Still, type CalculateMetadataFunction} from 'remotion';
import {Thumbnail, type ThumbProps} from './Thumbnail';
import {loadThumb} from './load';
import {THUMB} from './layout';

const calc: CalculateMetadataFunction<ThumbProps> = ({props}) => {
	const {resolved: _ignored, ...input} = props;
	void _ignored;
	const resolved = loadThumb(input);
	for (const w of resolved.warnings) console.warn(`[thumbnail] ${input.slug} ${input.lang} v${resolved.variant}: ${w}`);
	return {props: {...input, resolved}, defaultOutName: `${input.slug}-${input.lang}-v${resolved.variant}`};
};

export const ThumbnailCompositions: React.FC = () => (
	<Still
		id="Thumbnail"
		component={Thumbnail}
		width={THUMB.width}
		height={THUMB.height}
		defaultProps={{channel: '_dev', slug: 'thumb-demo', lang: 'en', variant: 0}}
		calculateMetadata={calc}
	/>
);
