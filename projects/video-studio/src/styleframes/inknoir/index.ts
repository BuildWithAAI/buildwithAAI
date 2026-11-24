import React from 'react';
import {Composition, registerRoot, type AnyZodObject} from 'remotion';
import {InknoirScene, inknoirSceneDefaults} from './Scene';
import {InknoirSheet, inknoirSheetDefaults} from './Sheet';

// Standalone entry for the "Ink Noir" host-character concept (index.ts cannot hold JSX).
//   npx remotion still src/styleframes/inknoir/index.ts InknoirScene out/styleframes/inknoir-scene.png --frame=30
//   npx remotion still src/styleframes/inknoir/index.ts InknoirSheet out/styleframes/inknoir-sheet.png --frame=30
const InknoirRoot: React.FC = () =>
	React.createElement(
		React.Fragment,
		null,
		React.createElement(Composition<AnyZodObject, typeof inknoirSceneDefaults>, {
			id: 'InknoirScene',
			component: InknoirScene,
			durationInFrames: 60,
			fps: 30,
			width: 1920,
			height: 1080,
			defaultProps: inknoirSceneDefaults,
		}),
		React.createElement(Composition<AnyZodObject, typeof inknoirSheetDefaults>, {
			id: 'InknoirSheet',
			component: InknoirSheet,
			durationInFrames: 60,
			fps: 30,
			width: 1920,
			height: 1080,
			defaultProps: inknoirSheetDefaults,
		}),
	);

registerRoot(InknoirRoot);
