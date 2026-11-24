# Crypto + AI security channel: channel copy (description, keywords, playlists, trailer)

Working slug `zoora-security`. Channel display name: **[CHANNEL NAME TBD]** (the owner decides). The show itself is "The Zoo & Badger Show" (CLAUDE.md, owner rules 2026-11-24), and the banner, avatar, watermark, sting and badges carry the show's name, not a channel name. They stay valid whatever the channel is called.

Written 2026-11-24 for the channel branding kit. The paste-ready fields are in the fenced blocks marked `id=...`. Tests read those blocks and check them against YouTube's limits and the house rules (`src/branding/tests/copy.test.ts`). Where each field goes in YouTube Studio is in `docs/BRANDING.md`.

## Channel name options (owner decides)

| Option | Length | Notes |
| --- | --- | --- |
| The Zoo & Badger Show | 21 | Recommended. It matches every asset in the kit, says "show", and the host's name is already in it. |
| Zoo & Badger | 12 | Shorter; reads well under the avatar. Loses "show". |
| Zoo & Badger Security | 21 | Says the topic, but the scope also covers AI, and "security" in a name can read like a company or a service. |

Before choosing:
- Check the handle's availability in Studio. It could not be checked from this session.
- The Data API caps the channel title at 30 characters (`brandingSettings.channel.title`).
- Avoid anything close to an existing security outlet's name. YouTube's impersonation policy covers names that are visually or phonetically similar (answer/2801947; `docs/research/platform-facts-2026-11-23.md`).

## Profile fields

| Field | Value |
| --- | --- |
| Name | [CHANNEL NAME TBD] |
| Handle | [HANDLE TBD] (pick it with the name) |
| Banner, picture, watermark | `public/brand/zoora-security/` (see `docs/BRANDING.md`) |
| Banner tagline | Crypto and AI security news. / What happened. How it worked. One fix. |
| Links | Owner to confirm. Owned domains only; no URL shorteners (CLAUDE.md "LINKS") |
| Contact email | A business address for tips and corrections (optional) |

## Channel description

The limit is 1,000 characters (Data API `brandingSettings.channel.description`, read 2026-11-24); the test keeps this text under it.

```text id=description
Crypto and AI security news, explained calmly by Zoo and his dog Badger.

When a protocol gets drained, a new wallet drainer spreads, or an AI agent gets talked into something it shouldn't do, we cover what happened, how it worked, and one fix you can use today.

On the channel:
- Shorts on single incidents: what happened, how it worked, one fix.
- "What we know" updates on big incidents, labelled developing until confirmed.
- A weekly roundup of the bigger picture.
- Explainers on the basics the news keeps coming back to.

Our rules: confirmed facts only, and we say where each one comes from. We don't name suspects, we don't publish exploit how-tos, and when we get something wrong we pin the correction.

Nothing here is financial or legal advice. We will never ask for your seed phrase, private keys or wallet details, and nobody legitimate will. Anyone who asks is running a scam.

Badger doesn't talk. He doesn't need to.
```

Why it reads this way:
- It promises only what the pipeline enforces: the claim gate, attribution, no suspects and no exploit how-tos (CLAUDE.md, channel 2 rules).
- It states no publishing cadence. The owner's rule is "don't publish daily unless each video adds real analysis", so a schedule line waits until one has held.
- The seed-phrase line doubles as a cryptophishing warning, since YouTube bans requests for wallet details.

## Channel keywords

Studio: Settings > Channel > Basic info > Keywords, one per line as below. The stored form (space-separated, multi-word keywords quoted) must stay within 500 characters; the test computes it.

```text id=keywords
crypto security
crypto hacks
DeFi exploits
crypto scams
wallet drainer
phishing
seed phrase
AI security
prompt injection
deepfake scams
voice clone scams
cybersecurity news
scam awareness
Zoo and Badger
```

## Playlists

Create these in Studio > Content > Playlists > New playlist. Put "Start Here", "What We Know" and "Weekly Roundup" on the Home tab first (Customization > Home tab > Add section > Playlists). The segment playlists collect each recurring segment, which is what returning viewers look for.

```text id=playlists
Start Here | The channel trailer and three explainers that cover the basics every security story builds on. | Trailer, then 3 hand-picked explainers | Manual order
Incident Shorts | One incident per Short: what happened, how it worked, one fix. | All incident Shorts | Newest first
What We Know | Updates on major incidents. Developing stories are labelled until the facts are confirmed, and corrections are pinned. | All "what we know" videos | Newest first
Weekly Roundup | The week in crypto and AI security, with the bigger picture and where the money went. | All weekly long-form round-ups | Newest first
Scam of the Week | One scam a week, taken apart: the hook, the trick, and how to spot it next time. | Every Scam of the Week segment or video | Newest first
Rekt Meter | Incidents rated on the Rekt Meter, so you can see how bad each one really was. | Videos with a Rekt Meter segment | Newest first
Zoo's One Fix | Every practical fix from the show in one place. Start at the top and work down. | The One Fix segments, cut as Shorts | Oldest first
Explainers | The basics behind the news: seed phrases, token approvals, phishing, prompt injection and more. | Evergreen explainers | Manual order
AI Security | AI agents that got tricked, malicious AI tools and plugins, deepfake and voice-clone scams. | AI-security videos | Newest first
```

Each line is: title | description | what goes in | order. Titles stay under 60 characters. Titles that carry the host's name keep it title case ("Zoo's One Fix"), never "ZOO".

## Channel trailer (about 51 s, then a 20 s end screen)

For viewers who have not subscribed (Customization > Home tab > Add section > Channel trailer; answer/3219384). Zoo speaks with Kokoro `im_nicola`; Badger reacts but never speaks. No facts: the trailer describes the show and names no real incident, project, person or figure, so it needs no sources. The Rekt Meter shot uses an illustrative meter with no incident named.

Assets: the intro sting `ShowSting` (src/branding), the show set from the show workflow (src/show, when it lands) or the episode engine's talk scenes, the thumbnail badges as on-screen labels, then the end screen `BrandEndScreen` (channel `zoora-security`).

| # | Time | Picture | Sound |
| --- | --- | --- | --- |
| 1 | 0:00.0-0:04.0 | Intro sting: plate, ampersand turns teal, Zoo turns to camera, Badger judges | Jingle (from the audio workflow) |
| 2 | 0:04.0-0:11.1 | Zoo at the desk, medium shot | Line 1 (6.66 s) |
| 3 | 0:11.1-0:15.5 | Two-shot; Badger's slow judging look to camera after "security" (1 s hold) | Line 2 (3.44 s) |
| 4 | 0:15.5-0:21.2 | Zoo; on-screen text: "What happened. How it worked. One fix." | Line 3 (5.30 s) |
| 5 | 0:21.2-0:24.2 | Badger close-up, ears go back; the "Badger's Red Flag" badge slides in | Line 4 (2.39 s) |
| 6 | 0:24.2-0:27.5 | An illustrative Rekt Meter (no incident named) with the "Rekt Meter" badge | Line 5 (2.87 s) |
| 7 | 0:27.5-0:34.0 | Zoo; the "What We Know" and "Developing" badges | Line 6 (6.10 s) |
| 8 | 0:34.0-0:40.2 | Zoo, medium close-up | Line 7 (5.73 s) |
| 9 | 0:40.2-0:45.4 | Zoo, close-up; Badger's restrained approving look | Line 8 (4.84 s) |
| 10 | 0:45.4-0:48.1 | Two-shot | Line 9 (2.69 s) |
| 11 | 0:48.1-0:50.6 | Badger: one long, unimpressed blink (18 frames) | Silence |
| 12 | 0:50.6-1:10.6 | End screen (20 s): subscribe circle and two video zones | Outro music (audio workflow) or silence |

Pauses between lines: 0.4-0.6 s. The times are the measured line lengths (below) plus pauses and Badger's beats: about 51 s before the end screen.

Narration (Zoo, one line per beat):

```text id=trailer-narration
When a protocol gets drained, or a new scam starts going around, this is where you find out what actually happened.
I'm Zoo. This is Badger. He runs security around here.
Every episode is one incident: what happened, how it worked, and one fix you can use today.
Badger flags the warning signs.
The Rekt Meter shows how bad it really was.
And when something big breaks, we tell you what we know, what we don't, and we call it developing until it's confirmed.
We only report what's confirmed, we say where it came from, and if we get it wrong, we pin the correction.
One more thing. We will never ask for your seed phrase. Nobody legitimate will.
Subscribe, and let Badger do the worrying.
```

Measured, not guessed: synthesized with Kokoro `im_nicola` (kokoro-onnx 0.6.1, int8, speed 1.0, en-us) on 2026-11-24: 40.0 s of speech, 126 words, 3.15 words per second. The per-line durations are in the table. Re-measure after any edit.

Claim review: no market figures, returns, suspects, incident names or third-party marks. "We will never ask for your seed phrase" is a policy the channel controls. "Nobody legitimate will" is the standard security guidance that wallet providers publish; it is phrased as advice, not as a statistic.
