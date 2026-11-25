# Font licences: every font the studio renders with

Checked 2026-11-25 by the Wave 3 integration. This is the one place that lists every font package the project loads, with its pin, licence and where the licence text is. Audio sources are recorded in `docs/AUDIO_LICENSES.md`; the branding kit's own font notes are in `docs/BRANDING.md` §6. The licence research behind this table (OFL 1.1 terms, the OFL FAQ and the three Latin families' upstream files) is in `docs/research/platform-facts-2026-11-23.md`, section "Licensing of music, sound effects and fonts".

**Rule:** add a font here, with this evidence, before its first use. Fonts load locally from npm (`@fontsource/*`, pinned in `package-lock.json`); nothing is fetched from Google at render time, and `@remotion/google-fonts` is not used.

| Font (package) | Version (pinned) | Licence | Copyright line in the licence file | Reserved Font Name | Licence text | Source | Loaded by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Anton (`@fontsource/anton`) | 5.3.0 | SIL OFL 1.1 | Copyright 2020 The Anton Project Authors (https://github.com/googlefonts/AntonFont.git) | none | `node_modules/@fontsource/anton/LICENSE` | https://registry.npmjs.org/@fontsource/anton/-/anton-5.3.0.tgz | `src/brand/fonts.ts` (display: thumbnail headlines) |
| Inter (`@fontsource/inter`) | 5.3.0 | SIL OFL 1.1 | Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter) | none | `node_modules/@fontsource/inter/LICENSE` | https://registry.npmjs.org/@fontsource/inter/-/inter-5.3.0.tgz | `src/brand/fonts.ts` (body, captions, UI), the branding kit, the product PDFs (`scripts/product/lib/styles.ts`) |
| Montserrat (`@fontsource/montserrat`) | 5.3.0 | SIL OFL 1.1 | Copyright 2011 The Montserrat Project Authors (https://github.com/JulietaUla/Montserrat) | none | `node_modules/@fontsource/montserrat/LICENSE` | https://registry.npmjs.org/@fontsource/montserrat/-/montserrat-5.3.0.tgz | `src/brand/fonts.ts` (headings), the branding kit, the product PDFs |
| Noto Sans Devanagari (`@fontsource/noto-sans-devanagari`) | 5.3.0 | SIL OFL 1.1 | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/devanagari) | none | `node_modules/@fontsource/noto-sans-devanagari/LICENSE` | https://registry.npmjs.org/@fontsource/noto-sans-devanagari/-/noto-sans-devanagari-5.3.0.tgz | `src/episode/i18n/fonts.ts` (Hindi dubs) |
| Noto Sans JP (`@fontsource/noto-sans-jp`) | 5.3.1 | SIL OFL 1.1 | Google Inc. | none | `node_modules/@fontsource/noto-sans-jp/LICENSE` | https://registry.npmjs.org/@fontsource/noto-sans-jp/-/noto-sans-jp-5.3.1.tgz | `src/episode/i18n/fonts.ts` (Japanese, which is blocked for now) |
| Noto Sans SC (`@fontsource/noto-sans-sc`) | 5.3.1 | SIL OFL 1.1 | Google Inc. | none | `node_modules/@fontsource/noto-sans-sc/LICENSE` | https://registry.npmjs.org/@fontsource/noto-sans-sc/-/noto-sans-sc-5.3.1.tgz | `src/episode/i18n/fonts.ts` (Chinese, experimental) |

How this was checked: each package's `package.json` declares `"license": "OFL-1.1"`; each `LICENSE` file carries the full SIL Open Font License 1.1 text (dated 26 February 2007) under the copyright line above, and the only "Reserved Font Name" in any of them is the licence's own definition, so no family reserves its name. The versions and tarball URLs are the entries in `package-lock.json`.

What OFL 1.1 means for us:

- **Videos, thumbnails, banners and PDFs are fine for commercial use.** A rendered frame or image contains no font software; OFL 1.1 condition 5 and the OFL FAQ (Q1.1, Q1.1.1, Q1.1.2) allow the fonts in logos, video titling and any design work, with no credit required.
- **The product PDFs embed font subsets** (Inter and Montserrat). OFL 1.1 allows fonts to be embedded in documents; they may not be sold on their own.
- **We do not redistribute the font files.** They are installed from npm and are not committed. If font files are ever committed or shipped, keep each family's `LICENSE` (OFL text plus copyright line) next to them.
- **No modified versions.** We never rename or alter the fonts, so the Reserved Font Name and modified-version conditions do not arise.
