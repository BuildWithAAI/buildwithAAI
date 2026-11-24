/**
 * Defaults and metadata of the QaRef-<id> compositions. Kept apart from QaCharacterRef.tsx so the shim can
 * register the reference without importing src/characters: the component is loaded only when a reference is
 * actually rendered, and a chart-only composition never depends on the character code.
 */
import type {CalculateMetadataFunction} from 'remotion';
import type {RefProps} from '../protocol.ts';

export const qaRefDefaults: RefProps = {items: [], width: 1920, height: 1080, fps: 30, durationInFrames: 1};

/** Size, fps and length come from the request: long enough that <Freeze> never clamps a local frame. */
export const qaRefMetadata: CalculateMetadataFunction<RefProps> = ({props}) => {
	const maxLocal = props.items.reduce((m, it) => Math.max(m, Math.ceil(it.localFrame) + 1), 1);
	return {
		width: props.width,
		height: props.height,
		fps: props.fps,
		durationInFrames: Math.max(1, props.items.length, props.durationInFrames, maxLocal),
		props,
	};
};
