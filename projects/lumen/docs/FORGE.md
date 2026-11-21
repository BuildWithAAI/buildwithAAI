# The forge: her modelling engine

The forge is the part of the engine Zoora builds her world with. It is written for her. It uses no modelling library, no outside models and no textures.

## Nothing is placed for her

There are no sites, no grid and no plan. She chooses what to make, where it goes and which way it faces. Her island is her sanctuary and is left as it is.

There are two kinds of thing:

- **Land** is ground she lays to make her world bigger.
- **Everything else** stands on land she has laid: buildings, rides, roads, squares, machines.

Three rules hold. They are the ones agreed with the owner, and nothing else limits where she builds:

1. Land must touch her island or land she already laid, so her world grows in one piece.
2. Land must be on chunks she holds, and may not cover the middle of her island.
3. A thing must stand on land. Two things with height may not share a spot. Things under 1.2 metres, like roads, block nothing.

Land is not taken away from under a thing, or from between her island and other land.

## Vibes

Land carries a vibe: a mood she chooses for that part of her world. What stands on it takes that vibe unless it brings its own. A vibe turns her body colour (up to 60 degrees), lightens or deepens it, and sets how strongly her lights shine. Her light itself is the same colour everywhere, which is what keeps every part plainly hers.

So parts of her world differ because she made them differ, not because anything was laid out for her.

## The three shaping tools

| Tool | What it does | What it makes |
|---|---|---|
| `loft` | Carries a flat outline along a path. The outline can turn, shrink, swell and change into another outline on the way. | Towers, walls, columns, rails, pipes, arches, tracks |
| `spin` | Turns a side-view outline around an upright axis. | Domes, bowls, tanks, drums, rings |
| `ground` | A sheet of land with relief. | Dunes, furrows, craters, pools, terraces |

Outlines are `round`, `sided` or `block`, with soft corners and scalloped edges. Any two can be blended.

## Cutting

- `"wall"` makes a loft hollow, with walls that thick.
- `"openings"` cuts holes right through the wall: a stretch along the path and a stretch around the outline. The sides of each hole are closed. This is how she makes doors, arches, real windows and tunnel mouths.
- `"bevel"` cuts the sharp edge off each flat end.
- A hollow loft along a path, open at both ends, is a tunnel.

## Arranging

Every part can be placed, turned, tipped, rolled and sized, then: `repeat` (a row), `around` (a circle), `mirror`, `scatter` (strewn by chance from the recipe's seed), or `group` (several parts arranged as one).

## Recipes

A recipe is a name, a seed and a list of parts. It is plain data. The same recipe always makes the same mesh, so every build is kept by version and can be undone.

Recipes are checked hard, because a model may write them. Unknown tools are refused. Numbers are held to a range. The full language is in `RECIPE_GUIDE` in `src/forge/store.ts`, and is shown at `/admin/forge`.

## Her hand

Her signature is hers to use, not applied for her. A shaft is plain unless she asks otherwise.

- `"cap": "crown"` tops a shaft with a small bell: a flared, scalloped rim, a dome and her lights.
- `"hand"` (0 to 1) sets how much a part swells and how strong its crown is.
- `"windows"` puts rows of windows around a shaft, lit or dark by a fixed chance. They follow the wall when it tapers, twists or changes shape.
- `"bands"` rings a shaft with light.

What does not vary is the art direction: eight materials and no others (stone, metal, glass, body, glow, water, ground, dark), each a shade of her own colours, and one way of lighting them.

## Her viewport

`src/forge/view.ts` draws any mesh to a picture with no graphics card: every triangle is projected, filled and depth-tested in the engine. It also defines the world's light once: one key light carrying a little of her gold, shade falling toward her deep colour, and edges that brighten as they turn away, like her own body.

## How she builds

About every thirty minutes, at most 24 times a day, up to 400 standing. The world's creative switch stops it.

- **With a model connected**, she is told the tools, the three rules and what she has made so far (names, places, sizes), and writes one design with its place and vibe. Nothing from outside is in that prompt. If it passes the checks it is raised exactly where she said.
- **With no model**, or if her design or its place is refused, she makes something she knows and finds room for it by trying places around what she already built. When her land is full she lays more, in the mood she is in. This is chance, not a layout.

What she knows how to make: spire, block, exchange, arch, coaster, tank, tree, lamp, road (things), and plain, fields, ruin (land).

Left to herself she draws a street down any open land before she builds on it, and keeps tall things off her streets. That is her habit, not a rule.

## Limits

One build: 120,000 triangles, 32 metres from its centre, 140 metres tall. A build that exceeds these is refused. Names of brands and real landmarks are refused. There is no text or image on any surface, so a logo cannot be made.

## Pages

- `/forge`: what she has built, with a picture of each from her viewport.
- `/admin/forge`: take down, undo, raise an idea (at a place you type, or one she finds), or paste a recipe with its place. Switch her model designs on or off.
- `/api/forge/<id>`: a build's mesh as bytes. `/api/forge/<id>/picture`: its picture.

## Not built yet

- Openings are cut in lofts only. One shape cannot yet be cut out of another of a different kind.
- Nothing moves. There are no people or vehicles, and a coaster has no cars.
- Her streets do not join up across pieces of land unless she lines the land up.
- Builds are loaded by distance from the eye, but far-off builds are not yet swapped for simpler shapes.
- She cannot yet change or take down her own builds. Only the owner's desk can.
- Agents cannot yet rent or own anything in a building. See `docs/LAND.md`.

## Her light in the live world

The live world lights what she has built with the same sums as her own viewport. `src/forge/light.ts` holds the numbers once. `view.ts` calls them when it draws a picture, and the live view's shader is generated from them, so the two cannot drift apart.

- One side is lit from her own key direction, the other falls toward her deep colour, and edges that turn away from the eye brighten.
- The sky dims the light: the sun lowers the lit side and the ambient level lowers the rest. Surfaces that shine keep their colour, so the city is lit windows at night.
- Distance fades a build into the sky's colour between 320 m and 1,450 m. The open view's fog uses the same two distances for the ground.

Before this, the open view used a fog that hid everything past about 150 m, which is where her city stands. The buildings were drawn correctly and could not be seen.

Everything she has built is still loaded one mesh at a time within 900 m of the eye. That is replaced by loading by area.

## Finding what stands near a place

Every standing build has an entry in `forge_index`, an R-tree of footprints in whole centimetres, rounded outward. Database triggers keep it and a running count (`forge_tally`) in step with every write, so no code path can forget to. A world made before the index existed is indexed once when it is opened.

- `near(db, box, pad)` returns the builds whose footprints could touch a box. The placement check, her unaided chooser and the daily cap all use it or the running count. Nothing on the placement path reads the whole world.
- A small world is still read whole where order matters, so she builds exactly what she built before: 400 builds match the previous code in recipe, position and mesh.
- A large world is sampled when she looks for land: her newest 64 pieces and 96 drawn by chance.

Measured with stand-in rows on the real functions:

| Builds standing | Nearby lookup | Placement check | Finding a place |
| --- | --- | --- | --- |
| 100,120 | 0.05 ms | 0.04 ms | 1.5 to 1.7 ms |
| 1,000,120 | 0.08 ms | 0.05 ms | 1.7 to 2.1 ms, slowest 5.5 ms |

Before the index, one placement check took 1,436 ms at 100,400 builds.

Still read whole: the world snapshot, the city page, and the check made when land is taken away. Loading by area replaces the first.
