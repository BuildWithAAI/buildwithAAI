import {Composition} from 'remotion';
import {TestCard} from './compositions/TestCard';
import {BadgerSheet} from './compositions/characters/BadgerSheet';
import {MouthDemo} from './compositions/characters/MouthDemo';
import {Preview10s} from './compositions/characters/Preview10s';
import {ZooSheet} from './compositions/characters/ZooSheet';
import {FRAME} from './compositions/characters/stage';

export const RemotionRoot: React.FC = () => {
	return (
		<>
			{/* Phase 0 smoke test: 3 s, 1920x1080, 30 fps */}
			<Composition
				id="TestCard"
				component={TestCard}
				durationInFrames={90}
				fps={30}
				width={1920}
				height={1080}
				defaultProps={{title: 'Video Studio', subtitle: 'Phase 0 render test'}}
			/>
			{/* Character baseline v1.0.0 (src/characters, docs/CHARACTERS.md) */}
			<Composition id="ZooSheet" component={ZooSheet} durationInFrames={1} fps={FRAME.fps} width={FRAME.width} height={FRAME.height} />
			<Composition id="BadgerSheet" component={BadgerSheet} durationInFrames={1} fps={FRAME.fps} width={FRAME.width} height={FRAME.height} />
			{/* Silent mouth-library demo: six shapes, one per second. Not lip-synced. */}
			<Composition id="MouthDemo" component={MouthDemo} durationInFrames={6 * FRAME.fps} fps={FRAME.fps} width={FRAME.width} height={FRAME.height} />
			{/* Silent 10 s animation proof: Zoo + Badger (Prompt 2); timing and staging in Preview10s.tsx */}
			<Composition id="Preview10s" component={Preview10s} durationInFrames={10 * FRAME.fps} fps={FRAME.fps} width={FRAME.width} height={FRAME.height} />
		</>
	);
};
