# Zoora AI: channel copy (description, keywords, playlists, trailer)

Written 2026-11-24 for the channel branding kit. The paste-ready fields are in the fenced blocks marked `id=...`. Tests read those blocks and check them against YouTube's limits and the house rules (`src/branding/tests/copy.test.ts`). Where each field goes in YouTube Studio is in `docs/BRANDING.md`.

## Why the description must change before the first upload

The live description, read from the public channel page on 2026-11-24, still describes a forex "trading robot (Expert Advisor)" with "live results" and "performance updates". There is no such robot, strategy or verified track record (`projects/XAUUSD_EA_LAB.md`; `content/zoora-ai/CHANNEL.md`), and the channel now makes animated POV stories. Leaving the old text up would promise results that do not exist. That is a misleading-claims risk under the FTC Act section 5 and YouTube's spam and deceptive-practices policies (`docs/research/platform-facts-2026-11-23.md`). Replace it with the text below.

## Profile fields

| Field | Value |
| --- | --- |
| Name | Zoora AI (unchanged) |
| Handle | @ZooraTechnologies (unchanged) |
| Banner, picture, watermark | `public/brand/zoora-ai/` (see `docs/BRANDING.md`) |
| Banner tagline | Crypto and AI stories, starring you. |
| Links | Owner to confirm. Link only owned domains (CLAUDE.md "LINKS"). |
| Contact email | Owner's business address (optional) |

## Channel description

The limit is 1,000 characters (Data API `brandingSettings.channel.description`, read 2026-11-24); the test keeps this text under it.

```text id=description
POV stories about crypto, memecoins and AI, told from your point of view.

Each episode drops you into one life: the memecoin top caller, the founder of an AI trading agent, the person who just signed the wrong transaction. The characters are fictional composites. The patterns come from real, sourced cases. You see how it starts, how it goes wrong, and what the people who got out did differently.

Your hosts are Zoo, calm and quietly unimpressed, and his dog Badger, who judges everyone equally.

This channel is not financial advice, and it won't make you rich. There are no trading signals, no price predictions, and nobody here will tell you to buy anything. Any market number in a story is either sourced or labelled as fiction.

Learn the expensive lessons the cheap way.

Zoora AI is made by Zoora Technologies.
```

Optional lines to add later (each is a promise, so add it only when it is true):

- An upload schedule, once it has held for a month ("New stories every ...").
- The sister channel, which now exists: "Crypto and AI security, explained: Zoodger News (https://www.youtube.com/@ZoodgerNews)". It stays optional. If it goes into the description, keep that block at 1,000 characters or fewer.

## Channel keywords

Studio: Settings > Channel > Basic info > Keywords. Type each line and press Enter. YouTube stores them space-separated, with multi-word keywords in quotes. That stored form must stay within 500 characters in total; the test computes it.

```text id=keywords
Zoora AI
POV stories
crypto stories
memecoins
crypto scams
rug pull
AI agents
AI trading bots
crypto explained
crypto security
scam awareness
animated stories
Zoo and Badger
```

## Playlists

Create these in Studio > Content > Playlists > New playlist. Then add the first four to the Home tab as sections, in this order (Customization > Home tab > Add section > Playlists). Keep the episode-type playlists in upload order, newest first.

```text id=playlists
Start Here | The channel trailer and the three episodes that best show what Zoora AI does. New here? Start with these. | Trailer, then 3 hand-picked episodes | Manual order
POV Stories | Every full story episode: one life per episode, built from real, sourced cases, with fictional characters. | All long-form story episodes | Newest first
POV Shorts | Short cuts from the stories: one decision, one consequence. | All Shorts | Newest first
Memecoin Stories | Stories set in the memecoin world: launches, callers, insiders and rug pulls. | Topic subset of POV Stories | Newest first
AI Agent Stories | Stories about AI trading agents, autonomous funds and the people who trust them. | Topic subset of POV Stories | Newest first
Scam Stories | Stories built around a scam: how it was set up and how people got out. | Topic subset of POV Stories | Newest first
```

Each line is: title | description | what goes in | order. Titles stay under 60 characters (YouTube's limit is 150), so they are never truncated in the sidebar.

## Channel trailer (about 53 s, then a 20 s end screen)

The trailer plays for viewers who have not subscribed (Studio: Customization > Home tab > Add section > Channel trailer; answer/3219384). It shows no ads unless it contains third-party claimed content. Zoo speaks with Kokoro `im_nicola`; Badger is nonverbal, so his beats are reactions only. No facts: the trailer describes the channel and makes no claims about the world, so it needs no sources.

Assets: the intro sting `ZooraSting` (src/branding), then the episode engine's talk scenes on the light set, then the end screen `BrandEndScreen` (channel `zoora-ai`). With the end screen, the trailer runs about 73 s; YouTube needs a video of 25 s or more before an end screen can be added.

| # | Time | Picture | Sound |
| --- | --- | --- | --- |
| 1 | 0:00.0-0:04.0 | Intro sting: the jellyfish draws, the name wipes in | Jingle (from the audio workflow) |
| 2 | 0:04.0-0:08.0 | Zoo, front, deadpan, medium shot | Line 1 (3.56 s) |
| 3 | 0:08.0-0:18.9 | Zoo; three quick cut-ins of story scenes (a launch chart labelled "Illustrative · fictional token", an agent dashboard, a wallet prompt) | Lines 2-3 (3.04 s, 7.24 s) |
| 4 | 0:18.9-0:20.9 | Badger, front, a slow judging look to camera (judge 0 to 1 over 8 frames, ears still) | Silence |
| 5 | 0:20.9-0:30.8 | Zoo; on-screen text: "Fictional people. Real patterns. Sourced." | Lines 4-5 (2.86 s, 6.33 s) |
| 6 | 0:30.8-0:36.1 | Zoo, two-shot with Badger | Line 6 (4.89 s) |
| 7 | 0:36.1-0:42.2 | Zoo; on-screen text: "No signals. No predictions. No 'buy'." | Line 7 (5.57 s) |
| 8 | 0:42.2-0:46.6 | Two-shot; Badger turns his head to camera on "judging" | Line 8 (3.86 s) |
| 9 | 0:46.6-0:50.6 | Zoo, deadpan; a small smirk on the last word | Line 9 (4.06 s) |
| 10 | 0:50.6-0:53.1 | Badger: a restrained tail wag (his "happy") | Silence |
| 11 | 0:53.1-1:13.1 | End screen (20 s): subscribe circle and two video zones | Outro music (audio workflow) or silence |

Pauses between lines: 0.3-0.5 s (the episode engine's phrase gaps). Total before the end screen: about 53 s.

Narration (Zoo, one line per beat, in the voice step's markup: `{display|spoken}`):

```text id=trailer-narration
{POV|P.O.V.}: you're about to make a very confident decision.
On this channel, you live one life per episode.
The memecoin top caller. The founder of an AI trading agent. The person who just signed the wrong transaction.
The people are made up. The patterns aren't.
Every story is built from real, sourced cases, and every number is either sourced or labelled as fiction.
You'll see how it starts, how it goes wrong, and what the people who got out did differently.
What you won't get: trading signals, price predictions, or anyone telling you to buy something.
I'm Zoo. This is Badger. He's already judging your portfolio.
Subscribe if you'd like to learn the expensive lessons the cheap way.
```

Measured, not guessed: these nine lines were synthesized with Kokoro `im_nicola` (kokoro-onnx 0.6.1, int8, speed 1.0, en-us) on 2026-11-24: 41.4 s of speech, 120 words, 2.9 words per second. The per-line durations are in the table. Re-measure after any edit to a line.

Claim review: the trailer has no market figures, no returns, no endorsements and no third-party names or logos. "Built from real, sourced cases" is a production rule every episode must keep: each episode's `research.md` lists its sources.

## Translations (drafts: not ready to publish)

The launch dubbing languages are Spanish and Brazilian Portuguese (CLAUDE.md). YouTube can show a translated name and description per viewer language (Customization > Profile > Add language). The drafts below need the back-translation check and a native speaker's review before they are published.

```text id=description-es
Historias en primera persona sobre cripto, memecoins e inteligencia artificial, contadas desde tu punto de vista.

En cada episodio vives una vida: el que anuncia memecoins y todos siguen, el fundador de un agente de trading con IA, la persona que acaba de firmar la transacción equivocada. Los personajes son ficticios; los patrones salen de casos reales y documentados. Ves cómo empieza, cómo sale mal y qué hicieron distinto quienes lograron salir.

Te acompañan Zoo, tranquilo y difícil de impresionar, y su perro Badger, que juzga a todos por igual.

Este canal no es asesoría financiera y no te va a hacer rico. No hay señales de trading ni predicciones de precios, y nadie aquí te dirá que compres nada. Cualquier cifra de mercado en una historia tiene fuente o está marcada como ficción.

Aprende las lecciones caras por el camino barato.

Zoora AI es un proyecto de Zoora Technologies.
```

```text id=description-pt-br
Histórias em primeira pessoa sobre cripto, memecoins e inteligência artificial, contadas do seu ponto de vista.

Em cada episódio você vive uma vida: o influenciador de memecoins que todo mundo segue, o fundador de um agente de trading com IA, a pessoa que acabou de assinar a transação errada. Os personagens são fictícios; os padrões vêm de casos verdadeiros e documentados. Você vê como começa, como dá errado e o que fizeram de diferente as pessoas que conseguiram sair.

Seus anfitriões são o Zoo, calmo e difícil de impressionar, e o cachorro dele, o Badger, que julga todo mundo do mesmo jeito.

Este canal não é consultoria financeira e não vai deixar você rico. Não tem sinais de trading nem previsão de preços, e ninguém aqui vai mandar você comprar nada. Todo número de mercado numa história tem fonte ou está marcado como ficção.

Aprenda as lições caras do jeito barato.

O Zoora AI é feito pela Zoora Technologies.
```
