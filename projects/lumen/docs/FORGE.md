# The forge: her modelling engine

The forge is the part of the engine Zoora builds her world with. It is written for her. It uses no modelling library, no outside models and no textures.

## Nothing is placed for her

There are no sites, no grid and no plan. She chooses what to make, where it goes and which way it faces. Her island is her sanctuary and is left as it is.

There are two kinds of thing:

- **Land** is ground she lays to make her world bigger.
- **Everything else** stands on land she has laid: buildings, rides, roads, squares, machines.

Four rules hold. They are the ones agreed with the owner, and nothing else limits where she builds:

1. Land must touch her island or land she already laid, so her world grows in one piece.
2. Land must be on chunks she holds, and may not cover the middle of her island.
3. A thing must stand on land. Two things with height may not share a spot. Things under 1.2 metres, like roads, block nothing.
4. Her roads are one network. Every road after her first must touch a road she already has. See "Her roads" below.

Land is not taken away from under a thing, or from between her island and other land. A road is not taken away if her network would be cut in two.

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

## Her roads

The owner's rule, 2026-11-21: all her roads connect, because she travels them to reach what she builds. She decides where every road goes. The forge lays none for her.

A road is a line she draws: `{"op": "road", "type": "avenue" | "street" | "alley", "through": [[x, z], ...]}`, with an optional `width` and `curve`. The forge lays the surface along that line: a dark bed, her light down the middle, and a pale kerb each side of an avenue or a street. The line her network uses is the line the surface is laid on, so what is joined in the network is joined on the ground.

| Kind | Bed width | What she gets if she does not say |
| --- | --- | --- |
| Alley | 2.5 to 6 m | 4 m, no kerb |
| Street | 6 to 10 m | 7.5 m |
| Avenue | 11 to 24 m | 14 m, two lines of light |

- A line has 2 to 24 points, each at least 3 m from the last. A turn is rounded. `curve` bends smoothly through every point.
- A build with a road in it lies flat, under 1.2 m. Lamps, trees and buildings are builds of their own. A road is not land, cannot be put in a group, and takes no arrangement, so its line is exactly where its surface is.
- One build reaches 32 m from its centre, so a long road is several builds end to end.

The rule, checked whenever a road is raised, changed, undone or taken down:

- **Her first road** may go anywhere on her land.
- **Every road after it** must touch a road she already has: the two surfaces overlap or come within half a metre. Otherwise it is refused (`FORGE_ROAD_ALONE`).
- **One build is one piece.** If it holds several lines they must reach each other (`FORGE_ROAD_BROKEN`).
- **Nothing cuts the network.** A road is not taken down, cut short or turned into something that is not a road if the roads it joined would no longer reach each other (`FORGE_ROAD_CUTS`). A road in a ring can go, because the others still meet the long way round.

To answer the last one, the forge walks outward along her roads from the ones the change touches. It stops at 4,000 roads and refuses. So a change is never allowed wrongly, and a ring of more than about 8,000 roads may be refused a change that was safe.

Measured with stand-in rows on the real functions, in a city where every road is joined:

| Builds standing | Roads | Find and lay a road that joins | Take a road out | Find room beside a road |
| --- | --- | --- | --- | --- |
| 100,050 | 50,018 | 4.7 ms, slowest 8.7 | 3.3 ms, slowest 16.2 | 4.2 ms |
| 1,000,040 | 499,989 | 5.8 ms, slowest 13.3 | 3.8 ms, slowest 5.8 | 6.1 ms |

A world made before this rule keeps its streets, and they become roads of the street kind when it is opened. They were never joined to each other, and nothing joins them for her. The rule holds for every road laid after.

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

- **With a model connected**, she is told the tools, the four rules, what she has made so far (names, places, sizes) and where her roads run, and writes one design with its place and vibe. Nothing from outside is in that prompt. If it passes the checks it is raised exactly where she said. If it is refused, she is told why the next time, in one fixed sentence chosen by the refusal's code. No text she or anyone else wrote is carried into that sentence.
- **With no model**, or if her design or its place is refused, she makes something she knows and finds room for it by trying places around what she already built. When her land is full she lays more, in the mood she is in. This is chance, not a layout.

What she knows how to make: spire, block, exchange, arch, coaster, tank, tree, lamp, road (things), and plain, fields, ruin (land).

Left to herself she has these habits. They are habits, not rules, and a model is bound by none of them:

- She brings a road onto new open land before she builds there. Her first road crosses open land at a place drawn by chance. Every road after it starts on a road she has, at a point drawn by chance, and runs on or turns off by chance, as an alley, a street or an avenue.
- She keeps two roads that run the same way at least 14 m apart, keeps roads on level open ground, and does not drive a road through something tall she built.
- What she raises stands beside a road and faces it, and never on one.
- She most often lays new land where one of her roads is heading, and not over the middle of land she already has.
- When there is no room left beside her roads, she most often adds a road before she lays more land.

Grown this way for 400 builds she had 101 roads, 3.6 km of them, in one network: 52 alleys, 43 streets and 6 avenues.

## Limits

One build: 120,000 triangles, 32 metres from its centre, 140 metres tall. A build that exceeds these is refused. Names of brands and real landmarks are refused. There is no text or image on any surface, so a logo cannot be made.

## Pages

- `/forge`: what she has built, with a picture of each from her viewport.
- `/admin/forge`: take down, undo, raise an idea (at a place you type, or one she finds), or paste a recipe with its place. Switch her model designs on or off.
- `/api/forge/<id>`: a build's mesh as bytes. `/api/forge/<id>/picture`: its picture.

## Not built yet

- Openings are cut in lofts only. One shape cannot yet be cut out of another of a different kind.
- Nothing moves. There are no people or vehicles, and a coaster has no cars.
- She does not travel yet. Her roads are one network, and nothing walks or drives on it. A build has no address.
- Roads lie level. There are no bridges, slopes or tunnels, and left to herself she keeps roads off land with relief, so fields and ruins can cut part of her land off from her roads.
- She has no land kinds for a beach or mountains yet. A model can shape land with the ground tool; her own ideas are plain, fields and ruin.
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
