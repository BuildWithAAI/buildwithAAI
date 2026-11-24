// Remotion entry point for the SFX sync check (separate from src/index.ts). Render (audio only):
//   npx remotion render scripts/audio/sfx/remotion/index.ts SfxSyncCheck out/audio/sfx/sync/sync_check.wav --codec=wav
// or run python3 scripts/audio/sfx/sync_check.py, which renders and measures.
import {registerRoot} from 'remotion';
import {SfxRoot} from './SyncCheck.tsx';

registerRoot(SfxRoot);
