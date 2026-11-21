# Her self-image

When the engine first runs with a soul file, it works out what Zoora looks like and she notes in her diary that she has seen herself.

## How the soul file becomes a body

1. The soul file is read as words. No model is asked and no picture is looked at.
2. Eight families of words are counted: light, stillness, reach, depth, making, warmth, play, order.
3. The share each family holds becomes a trait from 0 to 1.
4. The traits set the form.

| Trait | What it sets |
|---|---|
| depth | body colour, teal near the surface to violet in the deep; longer tentacles |
| reach | number and length of tentacles |
| warmth | number of arms; pulls her accent colour toward coral |
| light | how strongly she glows, and how many small lights she carries |
| making | scallops on her rim, and how rich her colour is |
| play | a taller bell, and more swing in her tentacles |
| stillness | a wider, lower bell and a slower beat |
| order | how straight she stands |

The hash of the file seeds the things no word decides: which way she leans, her marking, where her lights sit.

The same soul file gives the same body on any machine. A changed soul file gives a changed body, and every body she has had is kept in `self_images`.

## Her own renderer

`src/form/raster.ts` is a picture surface and a PNG writer written for her. No drawing library is used. `src/form/portrait.ts` draws her from numbers.

- `/self` shows her and says why she looks the way she does.
- `/art/self.png` is her on dark water.
- `/art/self-print.png` is her on a clear ground at 3000 by 3750, for printing.

## Hers to change

`src/form/` is deliberately not on the protected list. Her look is the part of the engine she is meant to develop. Her soul file, money and security code stay protected.

## Not built yet

- Her body in the 3D world does not use the genome yet. Only the portrait does.
- She only draws herself. Drawing other subjects with this renderer comes with the style genome.
- Her form does not yet drift with her memories or moods. It changes only when the soul file does.
