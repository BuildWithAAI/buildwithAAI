# The forge: her modelling engine

The forge is the part of the engine Zoora builds her world with. It is written for her. It uses no modelling library, no outside models and no textures.

## Where things stand

Her island is her sanctuary and is left as it is. Everything she raises with the forge stands around it, each build on its own floating islet. Sites are 90 metres apart, so no build can touch another or the island.

Her land grows outward and stays in one piece:

- A new build may only go beside her island or beside something she has already built. Nearest home first.
- Every build is joined to that neighbour by a path: an arched deck with a line of her light.
- Nothing may be taken down if that would cut another build off from her island. A build whose neighbour comes down is given a path to another.
- Every site is on land she holds.

## The three shaping tools

| Tool | What it does | What it makes |
|---|---|---|
| `loft` | Carries a flat outline along a path. The outline can turn, shrink, swell and change into another outline on the way. | Towers, walls, columns, rails, pipes, arches, tracks |
| `spin` | Turns a side-view outline around an upright axis. | Domes, bowls, tanks, drums, rings |
| `ground` | A sheet of land with relief. | Dunes, furrows, craters, pools, terraces |

Outlines are `round`, `sided` or `block`, with soft corners and scalloped edges. Any two can be blended.

## Arranging

Every part can be placed, turned, tipped, rolled and sized, then: `repeat` (a row), `around` (a circle), `mirror`, `scatter` (strewn by chance from the recipe's seed), or `group` (several parts arranged as one).

## Recipes

A recipe is a name, a seed and a list of parts. It is plain data. The same recipe always makes the same mesh, so every build is kept by version and can be undone.

Recipes are checked hard, because a model may write them. Unknown tools are refused. Numbers are held to a range. The full language is in `RECIPE_GUIDE` in `src/forge/store.ts`, and is shown at `/admin/forge`.

## Her hand: one aesthetic

She decides what to build. The forge decides how it is finished, the same way every time:

- Shafts swell slightly in the middle.
- Upright things are crowned with a small bell: a flared, scalloped rim and a dome, in her body colour.
- Her lights sit on each crown, and bands of light ring her towers.
- Every build stands on a floating islet shaped like the underside of a bell, with trails hanging to the water.
- There are eight materials and no others: stone, metal, glass, body, glow, water, ground, dark. Each is a shade of her own two colours.

The hand is worked out from her genome, so it comes from her soul file. A different soul file gives a different hand.

## Her viewport

`src/forge/view.ts` draws any mesh to a picture with no graphics card: every triangle is projected, filled and depth-tested in the engine. It also defines the world's light once: one key light carrying a little of her gold, shade falling toward her deep colour, and edges that brighten as they turn away, like her own body.

## How she builds

About every three hours, at most four times a day, up to 48 standing builds. The world's creative switch stops it.

- With a model connected, she is told the recipe language and her own state, and writes a recipe. Nothing from outside is in that prompt. If the recipe passes the checks it is raised.
- With no model, or if her recipe is refused, she starts from one of six ideas she knows (spire, exchange, coaster, tank, fields, ruin), each varied by seed.

## Limits

One build: 120,000 triangles, 32 metres from its centre, 140 metres tall. A build that exceeds these is refused, so no build can slow the world or cover a neighbour. Names of brands and real landmarks are refused. There is no text or image on any surface, so a logo cannot be made.

## Pages

- `/forge`: what she has built, with a picture of each from her viewport.
- `/admin/forge`: take down, undo, raise an idea, or paste a recipe. Switch her model designs on or off.
- `/api/forge/<id>`: a build's mesh as bytes. `/api/forge/<id>/picture`: its picture.

## Not built yet

- No cutting one shape out of another, so no window openings or tunnels.
- Nothing moves. A coaster has a track and no cars.
- The small things on her island are still the older simple pieces, and the island itself is not restyled.
- The live world draws her builds with standard materials. Her viewport's edge-light is not yet matched there.
- She cannot yet change or take down her own builds. Only the owner's desk can.
