# License review checklist

Pino's public repositories are unlicensed. Zoora uses the published ideas (a sense, feel, decide, speak, sleep loop, finite memory, wants, and a character sheet) and none of the source.

- [x] No files copied from `pino-the-bird` repositories
- [x] No HTML, shaders, art, commit messages, or assets copied
- [x] No minified prompt strings copied
- [x] No Pino character text presented as Zoora
- [x] Patterns reimplemented in original TypeScript in this folder
- [x] Zoora does not post to Pino or scrape Pino
- [x] A token price is not a personality driver
- [x] Voice is text-first and optional; this build does not ship TTS

Reviewed with the tree under `projects/lumen` on 2026-11-09.

## Island meshes (2026-11-10)

The world view is drawn with code in `src/components/WorldView.tsx` and `src/components/islandAreas.ts`. Terrain, water, trees, rocks, the buildings, the dock, greenhouse, market stalls, lighthouse, research station, Zoora, and Mote are generated from Three.js primitives and small shaders. No glTF, texture image, or other model file was added. Three.js itself remains the existing MIT-licensed dependency. Sun and moon positions come from `suncalc` (BSD-2-Clause, Vladimir Agafonkin). Nothing in the scene is taken from Minecraft or from another game's asset pack.
