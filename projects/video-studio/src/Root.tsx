import {Composition} from 'remotion';
import {TestCard} from './compositions/TestCard';

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
		</>
	);
};
