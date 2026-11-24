# Product builds: The Crypto Security Checklist and the sponsor media kit

This folder turns structured Markdown into designed, print-ready PDFs.

- `build.ts` builds a product's PDFs from `content/products/<id>/`. Today that is *The Crypto Security Checklist*,
  free and full editions.
- `media-kit.ts` fills the sponsor media kit in `docs/SPONSORS.md` with live figures from the dashboard.
- `spots/` is a separate Remotion entry point. It renders the Zoo and Badger spot illustrations from the character
  rigs in `src/characters/` as vector SVG. It never touches `src/Root.tsx`.

Everything is plain Node 22 TypeScript, run by type stripping. There is no build step and no new dependency.

## Commands

Run these from `projects/video-studio/`.

| Command | What it does |
| --- | --- |
| `node scripts/product/build.ts` | Both editions: renders the spots, lints, prints the PDFs, checks them and writes page previews (about 30 s) |
| `node scripts/product/build.ts --edition free` | One edition (`free`, `full` or `all`) |
| `node scripts/product/build.ts --skip-spots` | Reuses `<out>/spots/*.svg` instead of re-rendering the art (about 10 s) |
| `node scripts/product/build.ts --paper a4` | A4 instead of US Letter (both editions keep their page counts) |
| `node scripts/product/build.ts --lint` | Content lint only. No browser needed |
| `node scripts/product/build.ts --product <id> --out <dir> --preview-dpi 72` | Another product folder, output folder, or preview resolution |
| `node scripts/product/media-kit.ts --channel zoora-security` | The sponsor media kit: see `docs/SPONSORS.md`, section 1 |
| `node --test "scripts/product/tests/*.test.ts"` | The tests. Use the glob: Node 22 fails on a bare directory |

Add `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON` after `node` to silence Node's module-type notice.

Exit codes for `build.ts`:

- `0`: every check passed;
- `1`: content or output checks failed (the files are still written, so you can look at them);
- `2`: bad arguments, or a missing tool.

## Outputs

Everything goes to `out/product/`, which is gitignored. Rebuild instead of committing.

| File | What it is |
| --- | --- |
| `crypto-security-checklist-free.pdf` | The free edition: 2 pages, the email lead magnet |
| `crypto-security-checklist-full.pdf` | The full edition: 23 pages, the possible paid product |
| `free.html`, `full.html` | The pages that were printed. Open them in Chrome to inspect the layout |
| `spots/<id>.svg`, `spots/<id>.preview.png` | The spot illustrations, plus a PNG preview of each for quick review |
| `preview/<edition>-N.png` | One PNG per page, for review on a phone |
| `report.json` | Per edition: pages, contents page numbers, fonts, raster-image count, warnings, problems, and the open owner inputs |

## What the build checks

**Lint errors stop the build before printing (exit 1).** The lint is in `lib/lint.ts`. It runs on both editions and
on the marketing copy (`landing.md`, `kit-flow.md`). In the copy, an `https` link on the same line counts as a
citation. The rules:

- every figure needs a citation in the same item, table row or paragraph;
- a brand may appear only with a citation, so the product names categories, not products;
- no security promises ("100% safe", "unhackable", "risk-free", "stops all scams"), unless they sit inside
  quotation marks as a scam line;
- "Zoo" is never written "ZOO";
- no placeholders, no `http://` links, no unknown source or spot ids, no broken markup;
- `sources.json` must be valid: slug ids, `https` URLs, dates, a kind and a method for each source.

**Warnings are printed, but the build carries on.** The test suite requires zero warnings for the shipped content:

- a chapter of the full edition doesn't close with Badger's Red Flag and Zoo's One Fix;
- a source is never cited;
- a spot isn't rendered yet (`--skip-spots` with no SVGs in `<out>/spots/`).

**PDF problems fail the build (exit 1) after printing:**

- the page count is outside the edition's range in `product.json`;
- a font isn't embedded, or a font other than Inter or Montserrat is used;
- any raster image is present. The art must be vector;
- the browser reported an error or a failed request. The pages load nothing from the network;
- a contents entry has no PDF destination, or the contents page numbers moved between the two print passes.

Citations are numbered by first use in reading order. That's how they're built, not a separate check, and the tests
cover it.

## How a PDF is made

1. Parse and lint the Markdown (`lib/markdown.ts`, `lib/inline.ts`, `lib/lint.ts`).
2. Render the spots, unless you pass `--skip-spots`:
   1. bundle `spots/index.ts` with `@remotion/bundler`;
   2. render each spot with `renderStill` in the preinstalled Chromium. Spot sizes are set in `spots/catalog.ts`;
   3. `spots/Spot.tsx` measures the drawing, then redraws it with a line scale chosen so that every outline prints at
      exactly 1.05 pt, whatever the spot's size;
   4. it serializes the SVG and sends it back through numbered console chunks (`spots/protocol.ts`);
   5. `lib/svg-check.ts` rejects gradients, filters, patterns, opacity tints, embedded images and scripts, so the art
      stays flat, as the brand rules require.
3. Render HTML and CSS (`lib/render.ts`, `lib/styles.ts`). The CSS uses the brand tokens, Chromium's `@page` margin
   boxes for running headers and page numbers, and local `@fontsource` font files loaded by file URL.
4. Print with Playwright's Chromium (`lib/pdf.ts`):
   - PDF outline (bookmarks) and tagged PDF are on;
   - before printing, every font face is loaded and every image is decoded.
5. Fill in the contents page. The build reads the PDF's named destinations with `pdfinfo -dests`, writes the real
   page numbers into the contents, prints again, and checks that the numbers didn't move.
6. Write the document information (title, author, subject, keywords) with an incremental update (`lib/pdfmeta.ts`):
   - Chromium's own bytes are kept;
   - the new Info object is appended with its own cross-reference section.
7. Check the result with `pdffonts` and `pdfimages`, and write page previews with `pdftoppm`.

## Requirements

| Tool | Why | Where it comes from here |
| --- | --- | --- |
| Node 22 | Type stripping | Preinstalled |
| Playwright + Chromium | Printing the PDFs | Not a project dependency. Found through `PLAYWRIGHT_MODULE`, `NODE_PATH` or the global npm root. This machine has playwright 1.63 globally, with its browsers in `PLAYWRIGHT_BROWSERS_PATH` |
| poppler-utils (`pdfinfo`, `pdffonts`, `pdfimages`, `pdftoppm`) | Reading the PDFs back | Preinstalled. `build.ts` exits 2 without it |
| Remotion 4.0.541 and its Chromium | The spot illustrations | Project dependencies. The same browser detection as `remotion.config.ts` |

## The content dialect

Each product lives in `content/products/<id>/`:

- `product.json`: titles, licences, page ranges, owner inputs;
- `sources.json`: every source;
- one Markdown file per edition.

The Markdown is a small, strict subset. A typo stops the build with a line number; it never renders silently.

````md
---
title: The Crypto Security Checklist
subtitle: Practical steps to protect your wallets
byline: by Zoo & Badger
independence: No sponsors, no affiliate links
editionLabel: Full edition
version: 1.0
date: 2026-11-24
---

@cover

# Seed phrases {#seed-phrases kind=chapter spot=seed-phrases toc="One-line summary for the contents page."}

> The lede: the first quote after a chapter title.

## Do today {priority=today}

- [ ] **The action in bold.** Then the detail, with sources. [@source-id; @other-id]

:::redflag
Badger's Red Flag: the one sign of trouble.
:::

:::fix
Zoo's One Fix: the one thing to do.
:::
````

**Front matter.**

- `title`, `subtitle`, `byline`, `editionLabel`, `version` and `date` print on the cover and in the footer.
- `independence` is an optional statement printed on the cover and on the free edition's legal line. Code never adds
  it; only the content can make that claim.

**Directives.** Each sits alone on a line, starting in column 0:

| Directive | What it does |
| --- | --- |
| `@cover` | The cover page |
| `@toc` | The contents page, with page numbers filled in on the second print |
| `@sources` | The numbered source list. Each entry shows the publisher, title, date, link, and "(search extract)" when the fact could not be read at the source |
| `@pagebreak` | Starts a new page. In the free edition, it marks where the second page begins |

**Section headings** are level 1, with attributes in braces:

| Attribute | Meaning |
| --- | --- |
| `#id` | Required. The anchor and the PDF destination |
| `kind=` | `front`, `chapter` (numbered 01, 02 …), `appendix` (A, B …) or `back` |
| `spot=` | A spot illustration from `spots/catalog.ts` |
| `toc=` | The one-line summary on the contents page. Use single quotes inside it |
| `continue=true` | Shares the previous section's page; no forced page break |
| `frame=cut` | Prints the section inside a dashed cut-out frame, as on the emergency card |

**Lists, groups and tables.**

- `## Do today {priority=today}` starts a group. `today`, `week` and `habit` get matching icons.
- Checklists use `- [ ]`. Indented lines continue the item.
- Bulleted lists use `-`, numbered lists use `1.`, and tables are pipe tables. A table needs a header row and a
  separator row. Each table row needs its own citations.

**Inline text.**

- `**bold**`, `*italic*`, and `[text](https://…)` links (https only).
- Citations go in square brackets: `[@id]` or `[@id; @id2]`. They are numbered in reading order.
- Quotes become curly quotes automatically. Units, "Chapter N" and "Zoo & Badger" never break across lines.

**Fenced blocks.** Each opens with `:::kind Optional title` and closes with `:::`:

| Kind | Body | Prints as |
| --- | --- | --- |
| `redflag`, `fix` | Text or a list | Badger's Red Flag (dark) and Zoo's One Fix (light). Placed one after the other, they print side by side |
| `note` | Text | A titled side note |
| `steps` | A numbered list | Numbered steps in a box |
| `cards` | `- **Title.** text`. Add `{.stats}` for big numbers | 1-4 cards in a row |
| `ladder` | `- [best]`, `[good]`, `[weak]` or `[none]`, then `**Title.** text` | A strength meter with one rung per item |
| `compare` | `Label: 0x…` lines, all the same length | Addresses split into groups of four. Matching groups are highlighted, to teach the address-poisoning check |
| `flow` | `- **Step.** text` | Numbered stages joined by arrows |
| `fill` | `Label:` lines | Write-in lines for a printed form |
| `upsell` | Text | Free edition only: the box pointing to the full edition, with `fullEditionUrl` when it is set |

**Sources** (`sources.json`). Each entry has these fields:

- `id`, `title`, `publisher`, `date` (`YYYY-MM-DD`, `YYYY-MM` or `n.d.`), `url` (https) and `kind`;
- `method`: `read` means the page itself was read. `search-extract` means the official page was blocked from this
  environment, so the fact comes from search-index extracts of that page. Recheck these in a browser;
- `supports`: what the source is cited for.

## Spot illustrations

`spots/catalog.ts` lists 15 spots:

- the cover pair;
- the free edition's pair;
- one spot per chapter;
- the About pair, which the media kit reuses.

Each entry gives the characters, their views, poses and expressions, the printed height, and the alt text. The art
comes from the shared character rigs (`src/characters/`), so the spots follow the rigs whenever they change. Re-run
the build without `--skip-spots` after a rig update. The PDFs then contain no raster images: every line is vector at
any zoom.

## Licences

| Asset | Licence | Notes |
| --- | --- | --- |
| Inter, Montserrat (`@fontsource/inter` 5.3.0, `@fontsource/montserrat` 5.3.0) | SIL Open Font License 1.1 | Subsets are embedded in the PDFs, which the OFL allows. Neither font has a Reserved Font Name. Montserrat's subsets show its internal "MontserratThin-…" PostScript names |
| Zoo and Badger | The studio's own original art | Rendered from `src/characters/` |
| Icons (`lib/icons.ts`) | Original, drawn in code | 21 line icons on a 24-unit grid |
| Text and sources | Our own writing | Facts are cited. Nothing is copied beyond short quoted phrases, and the scam lines are paraphrased |

No stock images, no third-party illustrations, no remote assets.

## Owner inputs

The build lists any that are still open after every run, and stores them in `report.json`.

| Input | Where | Effect |
| --- | --- | --- |
| Legal name for the copyright line | `product.json` → `copyrightHolder` (now "Zoora AI") | Printed in the colophon and on the free edition's legal line |
| A public corrections email | `product.json` → `contact` | Printed on the About page. `null` hides the line |
| The link to the full edition | `product.json` → `fullEditionUrl` (a hub link) | Printed in the free edition's upsell box. `null` hides it |
| Price, refunds, updates, where to sell | `content/products/crypto-security-checklist/kit-flow.md` | Not printed in the PDFs |
