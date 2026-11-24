import {EpisodeCompositions} from './compositions';
import {ThumbnailCompositions} from '../thumbnails/compositions';

/** Episode entry root. Each builder owns its own compositions file; this file only composes them. */
export const EpisodeRoot: React.FC = () => (
	<>
		<EpisodeCompositions />
		<ThumbnailCompositions />
	</>
);
