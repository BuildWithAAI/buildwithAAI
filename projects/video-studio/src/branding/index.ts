// Remotion entry point for the CHANNEL BRANDING KIT (separate from src/index.ts and src/episode/index.ts).
// Stills:  npx remotion still src/branding/index.ts <id> public/brand/<channel>/<file>.png --image-format=png
// Stings:  npx remotion render src/branding/index.ts <id> out/brand/<channel>/<file>.mp4 --enforce-audio-track
// Everything at once (renders + QA): node src/branding/render.ts   (see docs/BRANDING.md)
import {registerRoot} from 'remotion';
import {BrandingRoot} from './Root';

registerRoot(BrandingRoot);
