// Visual QA fixture compositions (entry: src/qa/fixtures/index.ts). Not part of src/Root.tsx; never published.
//   node scripts/qa/selftest.ts                       (runs the checker on every fixture and asserts the result)
//   node scripts/qa/check.ts --entry src/qa/fixtures/index.ts --comp QaFxFaces
import React from 'react';
import {Composition} from 'remotion';
import * as F from './Fixtures';

const L = {width: 1920, height: 1080, fps: 30} as const;
const V = {width: 1080, height: 1920, fps: 30} as const;

export const QaFixturesRoot: React.FC = () => (
	<>
		<Composition id="QaFxClean" component={F.QaFxClean} durationInFrames={10} {...L} />
		<Composition id="QaFxText" component={F.QaFxText} durationInFrames={10} {...L} />
		<Composition id="QaFxSafe" component={F.QaFxSafe} durationInFrames={10} {...L} />
		<Composition id="QaFxShorts" component={F.QaFxShorts} durationInFrames={10} {...V} />
		<Composition id="QaFxFaces" component={F.QaFxFaces} durationInFrames={10} {...L} />
		<Composition id="QaFxOccluded" component={F.QaFxOccluded} durationInFrames={10} {...L} />
		<Composition id="QaFxContrast" component={F.QaFxContrast} durationInFrames={10} {...L} />
		<Composition id="QaFxMirror" component={F.QaFxMirror} durationInFrames={10} {...L} />
		<Composition id="QaFxStretch" component={F.QaFxStretch} durationInFrames={10} {...L} />
		<Composition id="QaFxFilter" component={F.QaFxFilter} durationInFrames={10} {...L} />
		<Composition id="QaFxClip" component={F.QaFxClip} durationInFrames={10} {...L} />
		<Composition id="QaFxForgery" component={F.QaFxForgery} durationInFrames={10} {...L} />
		<Composition id="QaFxBanding" component={F.QaFxBanding} durationInFrames={10} {...L} />
		<Composition id="QaFxFlicker" component={F.QaFxFlicker} durationInFrames={30} {...L} />
	</>
);
