/**
 * HowItWorked: a concept-level flat diagram (e.g. leaked key -> contract -> new address -> bridge), built from the
 * diagram primitives. Landscape: Zoo on the left points at it as the first node lands, then follows the later nodes
 * with his eyes. Vertical: the diagram takes the full frame above the captions, nodes stacked top to bottom.
 * No code, function names or step lists (validate.ts refuses them); a footnote marks it as a simplified concept.
 */
import React from 'react';
import {boxesOf, CardIn, SceneSource, SceneStage, type SceneCtx} from './common';
import {HeaderRow, headerSpace, PanelCard} from './cards';
import {list, str} from '../segments';
import {Diagram} from '../diagram/Diagram';
import {FitText, t} from '../graphics/text';
import {G} from '../graphics/theme';
import {showLabel} from '../ui';
import type {DiagramKind} from '../types';

export const HowItWorked: React.FC<{ctx: SceneCtx}> = ({ctx}) => {
	const {sc, sb, lang, format} = ctx;
	const card = boxesOf(ctx).card!;
	const r = ctx.plan.scenes[ctx.k].reveals;
	const land = format === 'landscape';
	const kinds = (sc.diagram?.nodes ?? []) as DiagramKind[];
	const labels = list(sc, 'nodes');
	const links = list(sc, 'links');
	const title = str(sc, 'title');
	const head = headerSpace(title, format);
	const foot = 56;
	const box = {x: card.x + (land ? 44 : 48), y: card.y + head + (land ? 40 : 40), w: card.w - (land ? 88 : 96), h: card.h - head - 40 - foot - 8};
	// a row reads best for up to three nodes in the landscape card; four or five stack top to bottom
	const orientation = land && kinds.length <= 3 ? 'row' : 'column';
	const reveals = kinds.map((_, i) => r.items[i] ?? r.card + 12 + i * 20);
	return (
		<>
			<SceneStage ctx={ctx} />
			<CardIn ctx={ctx} box={card} at={r.card}>
				<PanelCard box={card} title={title} lang={lang} format={format}>
					<Diagram kinds={kinds} labels={labels} links={links} reveals={reveals} box={box} orientation={orientation} lang={lang} />
					<FitText
						text={showLabel(sb, 'conceptOnly')}
						spec={t('body', 600, 24, 24, 1, 1.0)}
						lang={lang}
						box={{x: card.x + 28, y: card.y + card.h - foot, w: card.w - 56, h: 36}}
						color={G.inkMuted}
						align="right"
						what="diagram footnote"
					/>
				</PanelCard>
			</CardIn>
			<SceneSource ctx={ctx} />
			<HeaderRow ctx={ctx} />
		</>
	);
};
