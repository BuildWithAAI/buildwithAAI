// Remotion entry point for "The Zoo & Badger Show" (channel 2, zoora-security). Separate from src/index.ts and
// src/episode/index.ts. Render: npx remotion render src/show/index.ts ShowShort out/show/<slug>/en/short1.mp4 --props='{...}'
import {registerRoot} from 'remotion';
import {ShowRoot} from './Root';

registerRoot(ShowRoot);
