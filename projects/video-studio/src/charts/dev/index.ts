// Dev-only entry for chart test renders (not part of the main Root.tsx registry).
//   npx remotion still src/charts/dev/index.ts ChartTest out/charts/chart-test.png --frame=0
import {registerRoot} from 'remotion';
import {ChartDevRoot} from './ChartDevRoot';

registerRoot(ChartDevRoot);
