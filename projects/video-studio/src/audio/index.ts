// Remotion entry point for the audio integration (separate from src/index.ts, src/episode/index.ts and src/show/index.ts).
//   npx remotion render src/audio/index.ts AudioDemo out/audio/integration/audio-demo.mp4 --props=<json>
//   npx remotion render src/audio/index.ts AudioDemo out/audio/integration/audio-demo.wav --codec=wav --config=src/audio/remotion.wav.config.ts
import {registerRoot} from 'remotion';
import {AudioRoot} from './Root.tsx';

registerRoot(AudioRoot);
