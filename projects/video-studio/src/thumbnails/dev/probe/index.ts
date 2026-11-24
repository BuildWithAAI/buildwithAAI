// Dev-only entry: measures the character rigs' world-unit boxes for the thumbnail layouts (not part of any registry).
// npx remotion still src/thumbnails/dev/probe/index.ts ThumbProbe out/thumbnails/_probe.png --log=verbose
import {registerRoot} from 'remotion';
import {ProbeRoot} from './ProbeRoot';

registerRoot(ProbeRoot);
