# Engine demo: "Why most new memecoins die on day one"

End-to-end proof of the episode engine (2026-11-24): research, claim gate, voice, renders, thumbnails and dubbing in
en, es and pt-br. It is a test episode and is **not scheduled for publication**. The es and pt-br files are agent machine
translations (`translation.status: "machine"`), and every render of them carries the "MACHINE TRANSLATION · needs native
review" badge. The sources rest on the fact-checker's "holds" verdicts (search extracts); see `research.md` before any reuse.

| File | What |
| --- | --- |
| `research.md` | The facts used (all "holds" in `../pumpfun-top-caller/research.md`) and its "Must not say" section, copied verbatim |
| `storyboard.json` | English master: 7 scenes (all 7 templates), Badger in 5, fiction false, subscribe CTA, 1 Short, 3 thumbnails |
| `storyboard.es.json`, `storyboard.pt-br.json` | Written by `dub import` from the sheets below |
| `dub/sheet.es.json`, `dub/sheet.pt-br.json` | Translation sheets (provenance, reviewer notes on respellings and term choices) |
| `dub/backtranslation.es.json`, `.pt-br.json` | Back-translation records copied from `scripts/backtranslate/proof/zoora-ai-engine-demo` (a Claude session, NOT blind). The claim gate and dub validate scan their English with the English "Must not say" list; items made from text that changed since (s02, s05) count as stale until refreshed |

Changes of 2026-11-24 (review fixes): research.md gained "Must not say (es)" and "(pt-br)" sections (machine-made, for
the native reviewer to complete); the es and pt-br s02 say "bonding curve" (`{bonding curve|bóndin kerv}` /
`{bonding curve|bôndin kârv}`) instead of "curva de lanzamiento / lançamento", which crypto media do not use; es s05
says `{on-chain|onchéin}` (espeak es read "on-cháin"); the s05 attribution says "(cita traducida)" / "(citação
traduzida)", because the quote card shows a translation; the sources card shows translated source titles. The
English voice now says "meme coins" (channel lexicon; it was MEM-ih-coins).

## Reproduce (from `projects/video-studio/`)

```bash
# claim gate: without data/private/names.txt it FAILS on purpose (no-names-list); --no-names skips names, visibly
node scripts/claims/check.ts content/zoora-ai/_engine-demo --no-names            # claim gate (en)
python3 scripts/voice/build.py content/zoora-ai/_engine-demo --lang en --voice im_nicola
for L in es pt-br; do
  node scripts/dub/cli.ts prepare content/zoora-ai/_engine-demo --lang $L          # carries existing translations over
  node scripts/dub/cli.ts import content/zoora-ai/_engine-demo --lang $L           # import runs validate
  node scripts/claims/check.ts content/zoora-ai/_engine-demo --lang $L --no-names
  python3 scripts/voice/build.py content/zoora-ai/_engine-demo --lang $L --voice im_nicola   # native timing
done
npx remotion bundle src/episode/index.ts --out-dir=/tmp/episode-bundle
for L in en es pt-br; do
  npx remotion render /tmp/episode-bundle Episode out/episodes/_engine-demo/$L/episode.mp4 --props="{\"channel\":\"zoora-ai\",\"slug\":\"_engine-demo\",\"lang\":\"$L\"}"
  npx remotion render /tmp/episode-bundle EpisodeShort out/episodes/_engine-demo/$L/short1.mp4 --props="{\"channel\":\"zoora-ai\",\"slug\":\"_engine-demo\",\"lang\":\"$L\",\"shortId\":\"short1\"}"
done
node scripts/thumbnails.ts zoora-ai/_engine-demo --lang en,es,pt-br --out out/episodes/_engine-demo
# audio-track (multi-language audio) mode: keep it out of public/ so the native es timeline is not replaced
mkdir -p /tmp/fit/generated/zoora-ai/_engine-demo/en && cp public/generated/zoora-ai/_engine-demo/en/timeline.json /tmp/fit/generated/zoora-ai/_engine-demo/en/
python3 scripts/voice/build.py content/zoora-ai/_engine-demo --lang es --fit-to en --voice im_nicola --out-root /tmp/fit   # exit 3 = overflow
# the audio-track dub is fitted sentence by sentence (the master needs its `sentences`, written since 2026-11-24);
# the natural Spanish here is too long for that: each long sentence is listed with the % to cut
```
