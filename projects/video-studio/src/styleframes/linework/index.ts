import React from 'react';
import {Composition, registerRoot, type AnyZodObject, type CompositionProps} from 'remotion';
import {LineworkScene, lineworkSceneDefaults} from './Scene';
import {LineworkSheet, lineworkSheetDefaults} from './Sheet';

// index.ts cannot hold JSX. `comp` type-checks each call against Remotion's own
// CompositionProps; only the inner createElement call is widened, because its
// overloads cannot resolve CompositionProps' optional/mandatory-dimension union.
const comp = <P extends Record<string, unknown>>(props: CompositionProps<AnyZodObject, P>) =>
	React.createElement(Composition as unknown as React.FC<Record<string, unknown>>, props as Record<string, unknown>);

// Standalone entry for the "Linework" host-character concept.
// npx remotion still src/styleframes/linework/index.ts LineworkScene out/styleframes/linework-scene.png --frame=30
const LineworkRoot: React.FC = () =>
	React.createElement(
		React.Fragment,
		null,
		comp({
			id: 'LineworkScene',
			component: LineworkScene,
			durationInFrames: 60,
			fps: 30,
			width: 1920,
			height: 1080,
			defaultProps: lineworkSceneDefaults,
		}),
		comp({
			id: 'LineworkSheet',
			component: LineworkSheet,
			durationInFrames: 60,
			fps: 30,
			width: 1920,
			height: 1080,
			defaultProps: lineworkSheetDefaults,
		}),
	);

registerRoot(LineworkRoot);
