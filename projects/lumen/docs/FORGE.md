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

## Her buildings

The owner's direction, 2026-11-21: every building can be entered, and its details matter. A building is made with one tool, `{"op": "building", ...}`, and every number in it is hers.

| She sets | Range | If she does not say |
| --- | --- | --- |
| `outline` | a block, 3 to 16 straight sides, or round | required |
| `floors` | 1 to 60 | required |
| `floorHeight` | 2.6 to 8 m | 3.2 m |
| `wall` | 0.2 to 1.2 m thick | 0.3 m |
| `taper` | the top is 0.5 to 1 of the base | 1 |
| `windows` | bay width, and the window's share of the bay and the storey, its sill, the share lit; or none | a window every 3 m |
| `door` | which wall, how far along, width 0.9 to 6 m, height 2 to 5 m; or none | 1.6 by 2.4 m in the middle of the front |
| `roof` | a parapet or a flat roof with a kerb | parapet |
| `stairs` | where they stand; or none | against the back wall of a block, in the middle of any other shape |
| `inside` | the walls, doors and rooms she draws, floor by floor | every floor is one open space |

What the tool builds from those numbers:

- **Walls with thickness**, an outside face and an inside face.
- **Windows that are holes** through the wall, each with a frame, a sill that stands out from the wall, and a pane halfway through it. A lit pane glows. A clear one is glass, and the room shows through it. A wide window gets an upright and a tall one a rail.
- **A door that is a hole** through the wall, with a frame, leaves standing open into the building, a handle, a canopy with her light under it, and a step.
- **A floor at every storey**, with the ceiling of the storey below on its underside. Above the ground floor the stairwell is cut out, and has a glass rail on the three sides nobody steps through.
- **Stairs from every floor to the next.** Two flights with a landing where they fit. A spiral round a post where they do not. A ladder where a spiral does not. The kind is chosen so it fits on the top floor of a building that narrows.
- **A plinth** at the foot of the wall, **a coping** on top of it, and **a line of her light** under the coping.

The stairs and the headroom use the figures the International Building Code gives: no step rises more than 178 mm, each is 280 mm deep, and a storey leaves more than 2,286 mm clear.

A round building is given straight walls wide enough for a door: 8 for a small one, up to 24 for a large one. If she chooses many sides on a small building, no wall is wide enough for a door and it has none.

A building part is moved and turned and takes no other arrangement, so its floors stay level. It cannot be put in a group. Its front faces +z. A crown, columns, a sign, or anything she puts inside are parts of her own, made with the other tools.

Four of the things she knows how to make are buildings now, and each has a door on its front: every building in a block, the spire, the exchange, and the barn in her fields. Left to herself she turns a build so its front is toward the road it stands beside.

Counted in a world of 400 builds she grew with no model: 119 buildings with a door, 883 floors between them, stairs in every one with more than one floor. The world is 2.68 million triangles. About 1.25 million of those are the plants in her 24 fields, which were there before. A block of buildings is about 9,500 triangles and a spire about 20,000.

### Her rooms

The owner's direction, 2026-11-21 and 2026-11-22: she draws the inside herself, and each home and shop is a real room. Inside a building she draws walls and puts doors in them. Where her walls close a space off, that space is a room, the way a house-building game does it. She says which rooms are homes and which are shops by marking a spot inside each. A room she does not mark is a hall: a lobby, a corridor, a landing. The forge draws no wall, door or room she did not ask for.

```json
"inside": [{ "floors": [2, 9], "material": "stone",
  "walls": [{ "from": [-1.6, -6], "to": [-1.6, 6], "doors": [{ "at": 0.8, "width": 0.95 }] }],
  "rooms": [{ "at": [-5, 3], "use": "home", "name": "Corner Flat" }] }]
```

- **A layout names its floors**, counted from 1 at the ground: one floor, a run of floors, or every floor if it names none. A floor in no layout is one open space. Where two layouts name a floor, the later one is used.
- **Walls** are lines in the building's own metres, from its centre, with its front toward +z. A wall is cut off at the outside walls. One that stops within 0.25 m of another wall, or runs that far past it, is joined to it, so a room she meant to close is closed. A wall is 115 mm thick, a stud wall with board on both faces, and runs from the floor to the ceiling.
- **Doors** go in walls and nowhere else. `at` is how far along the wall as she wrote it, 0 to 1. A door is 0.82 to 2.4 m wide, 0.95 m if she does not say, and 2.05 m tall. The least width is a little over the 813 mm a building code asks of a doorway.
- **Rooms** are found from the walls: every closed space, however many sides it has, with its floor area and the widest circle that fits in it. A room that stands free in the middle of a floor is found too, and taken out of the room around it. The stairwell is never a room.
- **A building that tapers** keeps her walls where she drew them and cuts them off at each floor's own outside walls, so the rooms by the outside walls are smaller the higher they are. Every floor is judged on its own.

Four things are held to. A design that breaks one is not built, and with a model she is told which in one fixed sentence:

| Rule | Refused as |
| --- | --- |
| A home or a shop has at least 6.5 m² of floor and room for a circle 2.13 m across. A hall has room for a circle 1.12 m across. These are a building code's figures for the smallest liveable room and the narrowest corridor. | `FORGE_ROOM_SMALL` |
| Every room can be walked to: from the front door on the ground floor, and from the stairs on every floor above. From the front door she must be able to reach the stairs. | `FORGE_ROOM_SHUT` |
| No wall stands in the front doorway, on the stairs, or on the spot where people step off them. | `FORGE_ROOM_WAY` |
| A mark is inside a room, one mark to a room. A door fits on its wall, clear of the walls that join it. | `FORGE_ROOM_MARK`, `FORGE_ROOM_DOOR` |

**Walked to means walked.** The forge does not only check that rooms are joined by doors. It tries the floor on a 0.1 m grid with the same test the live world uses to move someone about (`canStand` in `src/world/walk.ts`): first with none of her walls, then with them. Anywhere that could be reached before and cannot be reached now has been shut off. That catches what a count of doors would miss, such as a door that opens onto the strip beside the stairs, which is too narrow to walk down. It errs toward refusing: a body just fits through an opening 0.62 m wide, and an opening under about 0.78 m may be counted as shut. A door is never that narrow.

**Her rooms are her homes and shops.** Each room marked `home` or `shop` is one unit, numbered floor by floor in the order she marked them, with an address such as "Lamp House, Home 302". Nothing she builds now is given a home or a shop that is not a room. See `docs/LAND.md`.

**Drawn only for someone inside.** Her inside walls are a mesh of their own, at `/api/forge/<id>/inside`. The live world fetches it when someone goes in and drops it when they leave. A build's own mesh is not one triangle heavier for its rooms, so her rooms cost nothing to anyone outside. What is drawn: each wall with a skirting at its foot; each door as an opening with a frame, wall above it, and a leaf standing open with a handle; and a small plate of her light beside the door of a home or a shop. The inside of one building may be at most 60,000 triangles.

Measured in a town of 150 builds she grew with no model: 37 buildings, every one with rooms; 1,096 rooms, of which 615 are homes, 97 shops and 384 halls; 712 homes and shops in all, each a room. All their inside walls together are 1.2 MB, fetched by nobody who stays outside. The largest plan is 34 KB. For a floor 20 m by 12 m with five rooms, working out the rooms takes about 3 ms, and walking the floor to judge it about 4 ms.

### Walking inside

`/api/forge/<id>/plan` gives each building in a build as the live world needs it: every floor's height and the space inside its outside walls, the solid stretches of her inside walls, her rooms, the front door, and the stairwell with the spot in front of it. It is worked out from the same layout as the mesh, so the two cannot disagree.

In the live world:

- **Tap a build** to see its name. Name boards no longer stand over every build at once.
- **Enter**, if it has a door. The eye goes in by the door nearest where she tapped and stands at a person's eye height, 1.6 m.
- **Look** by dragging. **Walk** by holding the Walk or Back button, or with W, A, S, D and the arrow keys. She stays inside the outside walls, goes round the stairwell, and is stopped by her inside walls. She slides along any wall she walks into, at whatever slant it runs, and is carried round the end of a wall into a doorway.
- **The room she is in is named** at the foot of the picture: "Hall", "Shop 102", "Corner Flat, Home 303". If it is a home or a shop nobody holds, its price is shown with a Buy button, which makes the same quote the city page makes. One somebody holds is marked Taken.
- **Up and Down** take her to the next floor by the stairs. **Leave**, or Escape, puts the view back where it was.

Her middle keeps 0.25 m from the face of any wall, which is a person's shoulders. A step is taken a tenth of a metre at a time, however long the frame took, so no step can carry her through a wall. She walks no faster on a slant than straight ahead.

`src/world/walk.ts` holds the walking and knows nothing about drawing, so it is tested on its own.

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

- **With a model connected**, she is told the tools (the building tool among them), the four rules, what she has made so far (names, places, sizes) and where her roads run, and writes one design with its place and vibe. Nothing from outside is in that prompt. If it passes the checks it is raised exactly where she said. If it is refused, she is told why the next time, in one fixed sentence chosen by the refusal's code. No text she or anyone else wrote is carried into that sentence.
- **With no model**, or if her design or its place is refused, she makes something she knows and finds room for it by trying places around what she already built. When her land is full she lays more, in the mood she is in. This is chance, not a layout.

What she knows how to make: spire, block, exchange, arch, coaster, tank, tree, lamp, road (things), and plain, fields, ruin (land).

Left to herself she has these habits. They are habits, not rules, and a model is bound by none of them:

- She brings a road onto new open land before she builds there. Her first road crosses open land at a place drawn by chance. Every road after it starts on a road she has, at a point drawn by chance, and runs on or turns off by chance, as an alley, a street or an avenue.
- She keeps two roads that run the same way at least 14 m apart, keeps roads on level open ground, and does not drive a road through something tall she built.
- What she raises stands beside a road, never on one, and is turned so its front, where the door is, faces that road.
- She draws rooms in every building she knows how to make. A wide building in a block has a hall from the front door to the stairs, with shops off it on the ground floor and flats off it above. A narrow one has a shop on the ground floor with the stairs behind it, and a home to each floor above. Her trading hall has shops down both sides, on both floors. Her spire has its stairs at the back and a home to each floor, as far up as a floor is still large enough for one. Every plan she draws by habit goes through the same check as a design from a model.
- She most often lays new land where one of her roads is heading, and not over the middle of land she already has.
- When there is no room left beside her roads, she most often adds a road before she lays more land.

Grown this way for 400 builds she had 101 roads, 3.6 km of them, in one network: 52 alleys, 43 streets and 6 avenues.

## Limits

One build: 120,000 triangles, 32 metres from its centre, 140 metres tall. A build that exceeds these is refused. Names of brands and real landmarks are refused, for a build and for a room. There is no text or image on any surface, so a logo cannot be made.

Inside one building: 12 layouts, 48 walls and 64 marked rooms to a layout, 4 doors to a wall, and 60,000 triangles for all its inside walls.

## Pages

- `/forge`: what she has built, with a picture of each from her viewport.
- `/admin/forge`: take down, undo, raise an idea (at a place you type, or one she finds), or paste a recipe with its place. Switch her model designs on or off.
- `/api/forge/<id>`: a build's mesh as bytes. `/api/forge/<id>/picture`: its picture. `/api/forge/<id>/plan`: how it is walked into, with her rooms. `/api/forge/<id>/inside`: her inside walls as bytes.

## Not built yet

- Openings are cut in lofts only. One shape cannot yet be cut out of another of a different kind.
- Nothing moves. There are no people or vehicles, and a coaster has no cars.
- She does not furnish her rooms yet. A part she puts inside a building is in the build's own mesh, is loaded with its outside, and is not something a walker goes round. Backlog 0u.
- A home or a shop is one room. A home of several rooms, a shop with its own door onto the street, and a wall with a window in it are not built.
- A building from before rooms existed may still have homes and shops that are a count, with no room of their own. Nothing changes them for her.
- Inside, she changes floor with a button and arrives in front of the stairs. She does not climb them step by step. She cannot walk out through the door: Leave puts the view back outside.
- There is one stair in a building and no lift. Buildings stacked on each other in one build are not joined by stairs.
- A building's floors and stairs are in the same mesh as its outside, and are loaded with it. Only her inside walls are fetched when someone goes in.
- She does not travel yet. Her roads are one network, and nothing walks or drives on it. A build has no address.
- Roads lie level. There are no bridges, slopes or tunnels, and left to herself she keeps roads off land with relief, so fields and ruins can cut part of her land off from her roads.
- She has no land kinds for a beach or mountains yet. A model can shape land with the ground tool; her own ideas are plain, fields and ruin.
- Builds are loaded by distance from the eye, but far-off builds are not yet swapped for simpler shapes.
- She cannot yet change or take down her own builds. Only the owner's desk can.
- An agent can buy a home or a shop. It cannot yet rent one, or change the inside of what it holds. See `docs/LAND.md`.

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
