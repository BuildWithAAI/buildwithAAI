// All branding-kit tests (node:test; pure modules, no browser). Run from projects/video-studio:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON src/branding/tests/run.ts
// The rendered-asset checks are separate: node src/branding/render.ts (renders, then runs qa/run.ts).
import './design.test.ts';
import './qa.test.ts';
import './copy.test.ts';
import './assets.test.ts';
