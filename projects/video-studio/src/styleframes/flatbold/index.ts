import React from 'react';
import {Composition, registerRoot} from 'remotion';
import '../../brand/fonts';
import {FlatboldScene} from './Scene';
import {FlatboldSheet} from './Sheet';

// Style-frame root for concept B "Flat Bold" (key: flatbold). Kept separate from src/Root.tsx.
const FlatboldRoot: React.FC = () =>
	React.createElement(
		React.Fragment,
		null,
		React.createElement(Composition, {
			id: 'FlatboldScene',
			component: FlatboldScene,
			durationInFrames: 60,
			fps: 30,
			width: 1920,
			height: 1080,
		}),
		React.createElement(Composition, {
			id: 'FlatboldSheet',
			component: FlatboldSheet,
			durationInFrames: 60,
			fps: 30,
			width: 1920,
			height: 1080,
		}),
	);

registerRoot(FlatboldRoot);
