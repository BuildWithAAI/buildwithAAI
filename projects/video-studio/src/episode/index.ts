// Remotion entry point for EPISODES (separate from src/index.ts, which holds the dev sheets and tests).
// Render: npx remotion render src/episode/index.ts Episode out/episodes/<slug>/<lang>/episode.mp4 --props='{"channel":"zoora-ai","slug":"...","lang":"en"}'
import {registerRoot} from 'remotion';
import {EpisodeRoot} from './Root';

registerRoot(EpisodeRoot);
