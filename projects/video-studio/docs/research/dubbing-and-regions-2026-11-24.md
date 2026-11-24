# Dubbing and regional growth: research, 2026-11-24

Scope: (1) YouTube multi-language audio tracks, auto-dubbing and localized metadata; (2) separate language channels vs. multi-language audio on one channel; (3) language priority for es, pt-br, hi, it, zh and ja; (4) regional rules for affiliate/referral links and crypto promotion in those languages' markets. It feeds the dubbing step (`Timeline.mode = 'native' | 'fit-to-master'` in `src/episode/types.ts`), the publish kit and the claim checker. Nothing here is legal advice. Any video that carries a paid promotion, an affiliate link or a token promotion still needs legal review per market.

## How this was verified

- **Read directly (primary) on 2026-11-24**, via curl through the session proxy: `support.google.com` (YouTube Help and Google Ads policy pages), `blog.youtube`, and the live YouTube Data API discovery document (`www.googleapis.com`, revision 20261123).
- **Read directly, but secondary:** `crypto.news`, `cryptobriefing.com`, `coinedition.com`. `theblock.co` and `thedefiant.io` are allowlisted but returned HTTP 403 (bot wall).
- **Blocked by the session network (proxy 403):** every regulator and data source outside Google, including chainalysis.com, ascionline.in, boe.es, cnmv.es, eur-lex.europa.eu, esma.europa.eu, consob.it, agcom.it, gov.br (CVM), conar.org.br, bcb.gov.br, argentina.gob.ar, pbc.gov.cn, mas.gov.sg, legco.gov.hk, fsc.gov.tw, caa.go.jp and datareportal.com. Facts from those sources rest on search-index extracts of the official pages and on secondary coverage. The WebFetch tool could not resolve any host in this session (`getaddrinfo ENOTFOUND`, even for allowlisted hosts), so all direct reads used curl.

**Status key** (as in `platform-facts-2026-11-23.md`, which writes `conflicting_sources` for `conflicting`):
- `confirmed`: the primary source was read directly in this session.
- `unverified`: the primary source could not be read. The fact rests on search-index extracts of the official page and/or secondary sources, as noted.
- `conflicting`: the sources disagree.
- Lines marked **Analysis** are recommendations derived from the facts, not facts.

---

## Answers in brief

1. **Multi-language audio (MLA)** is open to any creator with YouTube **advanced features** (phone verification plus channel history or ID/video verification). It is not limited to YPP. Upload is **desktop Studio only** (Languages → Add language → Dub → Add). The file must be **audio-only and "roughly the same length as your video"**, and **no API** exists for dub tracks or localized thumbnails. YouTube's **auto-dubbing has been available to everyone since 2026-02-04** (27 languages) and is **on by default for eligible creators**. English videos are auto-dubbed into es, pt, hi, it and ja, but **not into Chinese**. To upload your own dub for a language, **you must first delete that language's auto-dub**. Localized titles and descriptions are what YouTube **search** uses. Videos with MLA tracks average **>25 % of watch time from non-primary-language views**. YouTube does not say that audio tracks alone lift recommendations. (§1) `confirmed`
2. **Use one channel with MLA now, not separate language channels.** Each new channel must reach YPP on its own: 1,000 subscribers + 4,000 h today, and **8,000 h for new applicants from 2027-02-01**. **Termination of any one channel bars every channel you own.** Monetization suspensions can also spread to "related accounts". (§2) Facts `confirmed`; the recommendation is analysis.
3. **Language ranking:** es (1), pt-br (2), hi (3), it (4), zh (5), ja (6, blocked by TTS; on market merits it would sit near 3). This matches the owner's es + pt-br launch decision. (§3) Analysis built on mostly `unverified` market data.
4. **Regional rules:**
   - **Spain's CNMV crypto-advertising circular (1/2022) was repealed on 2024-12-28.** MiCA now governs. **India's ASCI disclaimer** is mandatory for any VDA promotion.
   - **MiCA**: Art. 7 statement for token marketing communications; Art. 91 conflict-of-interest disclosure; only MiCA-authorized providers since 2026-07-01; influencer promotion counts as solicitation.
   - **Brazil**: CONAR's 2026 influencer guide covers affiliate links and virtual characters.
   - **China**: Notice No. 42 [2026] bans all crypto business and its marketing. **Hong Kong** criminalizes ads for unlicensed stablecoins. **Singapore** bars crypto providers from using influencers.
   - **Google Ads does not approve crypto-exchange ads targeting Brazil, India, Mexico, Taiwan or Singapore.**

   (§4) Mostly `unverified` (regulator sites blocked). The Google pages are `confirmed`.

---

## 1. YouTube multi-language audio, auto-dubbing and localized metadata

### [confirmed] 1.1 Who can use multi-language audio today: creators with advanced features (not YPP-only)

The current help page reads: "Multi-language audio is currently available to creators with access to Advanced features." Older search-index copies said "a subset of creators", but the live page no longer says that. The 2025-09-10 YouTube Blog post announced "the expansion of multi-language audio to millions of creators over the coming weeks", after a two-year pilot. Advanced features require: phone verification, plus either "sufficient channel history" or ID or video verification ("ID and video verification isn't available to all creators"). "Only primary channel owners can verify their identity." Brand Accounts see the error "Advanced YouTube features aren't available for this account". YPP itself also lists "Have advanced features access on YouTube" as a requirement.

Sources: https://support.google.com/youtube/answer/13338784?hl=en · https://blog.youtube/news-and-events/multi-language-audio/ · https://support.google.com/youtube/answer/9891124?hl=en · https://support.google.com/youtube/answer/72851?hl=en
Source dates: help pages read 2026-11-24 (no last-updated date shown); blog post 2025-09-10.

### [confirmed] 1.2 How to upload a dubbed track, and the length rule

Steps (desktop only): "Sign in to YouTube Studio on your computer → From the left menu, select Languages → Click the video → Click Add Language and select your language → Next to 'Dub,' click Add → Click Select file → … Files must be in a supported audio-only file format and **roughly the same length as your video** → Click Publish." To replace a track: Languages → video → under "Audio" click Delete → upload again. Dubs work for **"a single video or Short"**. Edits to the original propagate: "If you manually trim or swap audio in the original video, those edits will propagate to the secondary tracks." The accepted file formats are not listed on the page. A third-party post says MP3 or WAV (`unverified`). Test one upload before relying on any format.

Sources: https://support.google.com/youtube/answer/13338784?hl=en
Source dates: read 2026-11-24.

### [confirmed] 1.3 The dub track must not carry different copyrighted audio

"Important: If we detect that the copyrighted content in the secondary audio track is different from the original audio, the file may be removed." **Analysis:** export each dub as a full mix (dub voice + the master's exact music bed and SFX), never with different music.

Sources: https://support.google.com/youtube/answer/13338784?hl=en
Source dates: read 2026-11-24.

### [confirmed] 1.4 How viewers get a track, and the preferred-language setting

"The audio tracks will automatically default to the viewer's preferred language, which is determined by their watch history. Viewers can change their preferred language in their settings. They can also switch between languages using the video player settings." The 2026-02-04 auto-dub post added an explicit Preferred Language setting. The help page on it says: "Content with the original audio in one of your preferred languages will not be translated and will default to the original audio. This setting applies for translations of audio (dubs), titles and descriptions." It also says: "Your preferred language setting is separate from your app language and location settings, **it does not impact your search results or video recommendations**." So a bilingual es/en viewer hears the English original.

Sources: https://support.google.com/youtube/answer/13338784?hl=en · https://support.google.com/youtube/answer/13339776?hl=en · https://blog.youtube/news-and-events/youtube-auto-dubbing-expressive-speech/
Source dates: help pages read 2026-11-24; blog 2026-02-04.

### [confirmed] 1.5 Does adding audio tracks help discovery in those languages?

What YouTube says, and what it does not say:
- **Search uses translated metadata.** "Once your videos are translated, your videos can be found when viewers search using a translated video title and description. Our search systems look at these translated titles and descriptions to provide accurate results in the language they speak." Also: "Translated metadata may increase a video's reach and discoverability. Translated video titles and descriptions can show up in YouTube search results for viewers who speak those other languages."
- **Average outcome for MLA creators:** "Creators who uploaded Multi-language audio tracks saw over 25% of their watch time come from views in the video's non-primary language" (help page and the 2025-09-10 blog).
- **Auto-dubs:** "there's no negative impact on your original video's discovery algorithm, and it might be able to help with discovery in other languages" (blog, 2026-02-04). Also "having your videos dubbed has no negative impact on viewer discovery, only potential upside" (blog, 2026-05-15).
- **Not stated anywhere:** that an audio track by itself raises recommendations in that language.

**Analysis:** treat dub tracks as watchability/retention, and translated titles and descriptions as the discovery lever. Always ship both.

Sources: https://support.google.com/youtube/answer/13338784?hl=en · https://support.google.com/youtube/answer/4792576?hl=en · https://blog.youtube/news-and-events/multi-language-audio/ · https://blog.youtube/news-and-events/youtube-auto-dubbing-expressive-speech/ · https://blog.youtube/creator-and-artist-stories/youtube-auto-dubbing-explained/
Source dates: help pages read 2026-11-24; blogs 2025-09-10, 2026-02-04, 2026-05-15.

### [confirmed] 1.6 YouTube's own best practices for MLA

- "Prioritize depth: Focus your efforts on one or two languages, and strive to dub as much content as you can for them."
- "Dub your back catalog: … dubbing half or more of your existing video catalog can provide additional opportunities for new viewers to discover your content."
- "Translation accuracy: We recommend that your second language tracks match the primary language translation as closely as possible."
- "Automatic captions will be available in the language of the original audio track."
- "Use YouTube Analytics to track your views and watch time broken down by audio language."
- "You are a good candidate if you already have viewership from multiple geographies or have frequent comments in different languages."

Sources: https://support.google.com/youtube/answer/13338784?hl=en
Source dates: read 2026-11-24.

### [confirmed] 1.7 Localized titles, descriptions and thumbnails

- **Titles and descriptions:** add a language, then under "Title and description" click Add and publish. The help article says "From the left menu, select Subtitles"; the newer MLA page calls the menu "Languages". "We'll show the title and description of the video in the right language, to the right viewers."
- **Localized thumbnails:** "For long-form videos, you can also upload thumbnails in different languages." Viewers "will be shown thumbnails that match their language setting". Path: Content → video → upload the default thumbnail → Languages → language → next to Thumbnail, click Add.
- The 2025-09-10 blog said localized thumbnails were then a pilot. A March 2026 expansion to all MLA creators is reported only by secondary sources (`unverified`). The live help page now documents the feature without a pilot caveat.

Sources: https://support.google.com/youtube/answer/6289575?hl=en · https://support.google.com/youtube/answer/13338784?hl=en · https://blog.youtube/news-and-events/multi-language-audio/ · https://vidiq.com/blog/post/multilingual-thumbnail-feature-youtube/ (secondary)
Source dates: help pages read 2026-11-24; blog 2025-09-10.

### [confirmed] 1.8 What the YouTube Data API can and cannot automate (discovery doc rev 20261123)

- **Can:** `Video.localizations` ("localized versions of the basic details about the video, such as its title and description") with `VideoLocalization.title` and `.description`; `snippet.defaultLanguage`; `snippet.defaultAudioLanguage` ("the language spoken in the video's default audio track"); `captions.insert` with `CaptionSnippet.language` (translated subtitle tracks).
- **Cannot:** the discovery document has no method or field for dub/audio-track upload or for per-language thumbnails. `thumbnails.set` takes only `videoId` and `onBehalfOfContentOwner`.

Consequence: dub upload and localized thumbnails are manual Studio steps. Titles, descriptions and subtitles can be automated: `videos.update` with part `localizations` (quota 50) and `captions.insert` (quota 400, per `platform-facts-2026-11-23.md`).

Sources: https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest
Source dates: revision 20261123, fetched 2026-11-24.

### [confirmed] 1.9 YouTube auto-dubbing: availability, languages, and how it interacts with your own dubs

- **Availability:** "Auto dubbing is now available to everyone, with an expanded library of 27 languages" (blog, 2026-02-04). "Expressive Speech for all YouTube channels in 8 languages (English, French, German, Hindi, Indonesian, Italian, Portuguese and Spanish)."
- **Defaults:** the help page says "This feature is enabled by default for eligible creators … When you upload a new video, dubs will be automatically generated … Over time, we may also generate dubs for previously published videos."
- **Audience:** "In December, YouTube averaged more than 6 million daily viewers who watched at least 10 minutes of auto dubbed content."
- **From English, the help table lists:** Arabic, Bengali, Dutch, French*, German*, Hebrew, Hindi*, Indonesian*, Italian*, Japanese, Korean, Malayalam, Polish, Portuguese*, Punjabi, Russian, Spanish*, Tamil, Telugu, Ukrainian (* = expressive speech). **Chinese is not an English→target**: Chinese and Traditional Chinese are listed only as sources into English. Spanish→Portuguese and Portuguese→Spanish exist.
- **Interaction with your own dubs:** "If an automatic dub already exists for a language, you must delete it before uploading your own version." Also "You cannot edit automatic dubs", and "Once a dub is deleted, it won't be available and you can't republish it".
- **Settings:** turn auto-dubbing on or off, or choose "Publish manually" to review dubs before they go live (Studio app → Settings → Content → Automatic dubbing). Dubbed videos are "marked as 'auto-dubbed' in the video description".
- **Ineligible videos:** longer than 120 minutes, no or little speech, unsupported or undetected language, speech too fast, or copyrighted content.
- **Experimental lip sync** ("Alters the speaker's lip movement") exists for select channels only. It is not relevant to ZOO's mouth library.

Sources: https://support.google.com/youtube/answer/15569972?hl=en · https://blog.youtube/news-and-events/youtube-auto-dubbing-expressive-speech/ · https://blog.youtube/creator-and-artist-stories/youtube-auto-dubbing-explained/
Source dates: help page read 2026-11-24; blogs 2026-02-04 and 2026-05-15.

### [confirmed] 1.10 Thumbnail Test & Compare (relevant to the 3-variant thumbnail plan)

- **What it does:** "Creators can test and compare up to 3 different titles and thumbnails." The winner is chosen by **watch time**, not CTR.
- **Eligibility:** desktop Studio only; advanced features required; "not able to A/B test Shorts"; not for made-for-kids, "mature audiences" or private videos.
- **Stopping rules:** "If a video's title or thumbnail is changed during the test, the test will automatically stop." Thumbnails below 1280×720 force every variant down to 854×480. Tests take "a few days or up to 2 weeks".
- **Gap:** how Test & Compare interacts with localized thumbnails is **undocumented**. **Analysis:** run the A/B test on the default thumbnail first, and add localized thumbnails only after the test ends. Otherwise the change may stop the test.

Sources: https://support.google.com/youtube/answer/13861714?hl=en
Source dates: read 2026-11-24.

### Analysis 1.11: what MLA means for the episode engine

- **One picture for every track.** With MLA, the mouth shapes and all on-screen text (bullets, chart labels, step lists, captions burned in) are those of the master (en) render. Only audio, title, description, subtitles and the long-form thumbnail are per-language. Exact lip-sync and localized on-screen text need a separate upload (`mode: 'native'`).
- **`fit-to-master` dubs** must fit the master's scene durations. Per scene: time-fit the dub line inside the master line's time window (Kokoro speed within a small range, then shorten the translation, then pad with silence). Keep sentence starts and ends aligned so "talking vs. closed mouth" matches even when the visemes do not. Mix to one file per language whose length equals the master's.
- **Keep master on-screen text language-light:** numbers, icons, short labels. Any disclosure that must appear on screen in each language (see §4) needs a stacked multilingual card that holds long enough for the longest-reading language.
- **Before uploading our own es/pt-br dubs:** set auto-dubbing to "Publish manually", then delete the es and pt auto-dubs on each video. Spot-check the remaining auto-dubs (hi, it, ja …) before publishing them, because they cannot be edited.
- **Language variants:** YouTube's language list has regional variants such as Spanish (Latin America) vs. Spanish (Spain), Portuguese (Brazil) and Chinese (Simplified/Traditional). Which variants Studio offers for dub tracks was not verified (`unverified`). Check `i18nLanguages.list` (1 quota unit) in the publish kit.

---

## 2. Separate language channels vs. multi-language audio on one channel

### [confirmed] 2.1 YPP thresholds apply per channel, and they rise for new applicants on 2027-02-01

**Today:** "1,000 subscribers with 4,000 qualified watch hours in the last 12 months, or … 1,000 subscribers with 10 million qualified Shorts views in the last 90 days." Only watch hours from public long-form videos count.

**From 2027-02-01:** "YPP entry thresholds for new creators are changing to 8,000 qualified watch hours in the last 365 days, or 20M qualified Shorts views in the last 90 days, in addition to still needing 1k subscribers. If you are already in YPP, your status is not impacted." The fan-funding/Shopping tier is unchanged (500 subscribers + 3,000 h or 3M Shorts views).

**New activity rule from 2027-02-01:** a channel counts as active with 1,000 qualified watch hours in 365 days, or 1M qualified Shorts views in 90 days, or 2 long-form videos or 5 Shorts uploaded every 90 days. Shorts revenue sharing will need 10M qualified Shorts views per 90 days.

This promotes the 2027 change, marked `unverified` in `platform-facts-2026-11-23.md`, to `confirmed`.

**Inference:** dub-track views are views of the same public video, so their watch time counts toward that channel. YouTube does not state this explicitly.

Sources: https://support.google.com/youtube/answer/72851?hl=en · https://support.google.com/youtube/answer/12843009?hl=en · https://blog.youtube/news-and-events/youtube-partner-program-updates-2027-new-opportunities-earn/
Source dates: help pages read 2026-11-24; blog 2026-08-10.

### [confirmed] 2.2 YouTube's own framing: MLA instead of separate channels; when separate channels help

MLA "is a powerful way to expand your global reach without creating and managing multiple separate channels". "Simplified Management: … compared to managing multiple language-specific channels."

The "Pick a strategy for reaching global audiences" page lists three models:
- **One channel with multiple languages:** "Using one channel consolidates your viewership and subscribers", but posts and comments come in many languages, "This may be confusing for your audience".
- **Separate channels per language:** "helpful for languages with varied alphabets or search terms", gives "focused communication", and "Each individual channel will need ongoing maintenance".
- **A global channel plus local channels:** "requires the most time and effort".

Sources: https://support.google.com/youtube/answer/13338784?hl=en · https://support.google.com/youtube/answer/6070467?hl=en
Source dates: read 2026-11-24.

### [confirmed] 2.3 Circumvention: one terminated channel bars all of the owner's channels

"If your YouTube channel is terminated, you are prohibited from using, possessing, or creating any other YouTube channels … This applies to all of your existing channels, any new channels you create or acquire, and any channels in which you are repeatedly or prominently featured." A pilot lets some terminated creators request a new channel after one year. It excludes creators terminated for copyright infringement or Creator Responsibility violations.

Sources: https://support.google.com/youtube/answer/2802168?hl=en · https://support.google.com/youtube/answer/16369459?hl=en
Source dates: read 2026-11-24.

**Analysis:** this already ties Zoora AI to the planned second channel (`zoora-security`; `CLAUDE.md`: "A strike on either channel endangers both"). Every language channel added would be one more channel whose termination ends all of them.

### [confirmed] 2.4 Demonetization and feature restrictions can also spread across related channels

- "Severe violations of our YouTube channel monetization policies may result in monetization being permanently disabled on any of your accounts."
- "Videos with Community Guidelines strikes, copyright strikes, and videos with visuals matching third-party content may contribute to monetization suspension on all your related accounts."
- Creator responsibility: "If any of your channels have been demonetized or terminated, you should not create new (or use existing) channels to get around these restrictions … Doing so could lead to termination of all channels."
- Advanced-feature access can be delayed or restricted for "Posting the same content repeatedly across one or more channels" and for "Maintaining channels that are related to another policy-violating channel".

**Analysis:** dubbed copies of the same animation on several channels sit uncomfortably close to "the same content … across one or more channels". Nothing official says dubbed versions count, so this is a risk, not a rule.

Sources: https://support.google.com/youtube/answer/1727191?hl=en · https://support.google.com/youtube/answer/1311392?hl=en · https://support.google.com/youtube/answer/9891124?hl=en
Source dates: read 2026-11-24.

### [confirmed] 2.5 Monetization policies that apply to every channel and language: inauthentic content and AI personas

Not allowed to monetize:
- "AI-generated content made with generic or unoriginal templates giving the impression of mass production without adding the creator's original, authentic insights or perspective".
- "Videos where characters are put in the same situation over and over again with the same outcome".
- **"AI Personas Related to Sensitive Topics"**: "channels that use AI-generated personas to deliver information on sensitive topics. This includes any content that presents itself as a human expert providing advice to viewers on topics such as health, legal issues, finances, or politics." The page gives the example "AI-generated podcast hosts offering financial guidance, investment tips, or wealth management advice".

Allowed: "a series following a set of characters across episodes … in which each video has a distinct storyline", and "using AI to visualize a unique character and narrative you invented".

Secondary press dates the July 2026 clarification to 2026-07-13/16 (`unverified`).

**Analysis:** ZOO must never be framed as a human financial expert giving advice, in any language. Translations must keep that framing, so this belongs in the native-review checklist.

Sources: https://support.google.com/youtube/answer/1311392?hl=en · https://www.tubefilter.com/2026/07/13/youtube-inauthentic-content-monetization-policy-update/ (secondary) · https://techcrunch.com/2026/07/20/youtube-clarifies-policies-around-ai-slop-and-upsetting-videos/ (secondary)
Source dates: policy page read 2026-11-24; press 2026-07-13/20.

### Analysis 2.6: trade-off table

| Factor | MLA tracks on the main channel | Separate language channel |
| --- | --- | --- |
| YPP | All watch time and subscribers accrue to one channel (§2.1 inference) | Each channel must reach 1k subs + 4k h alone, or 8k h if it applies on or after 2027-02-01. A channel started now realistically applies after that date. |
| Staying active (2027) | One channel to keep active | Each channel needs 2 long-form videos or 5 Shorts per 90 days, or 1k h/365 d |
| Discovery | Translated titles and descriptions are indexed. Dubs play by default for matching viewers. Avg >25 % of watch time from non-primary languages. Home page, posts and comments are mixed-language. | Fully localized channel name, about, posts and Shorts feed. YouTube says it suits "varied alphabets or search terms" (hi, zh, ja). |
| Lip-sync and on-screen text | Locked to the master language | Full native re-render (`mode: 'native'`) |
| Thumbnails and A/B | Localized thumbnails (long-form, Studio only). Interplay with Test & Compare is undocumented. | Own thumbnails and own Test & Compare |
| Operations | Dub upload and localized thumbnails are manual Studio steps. Titles and subtitles go through the API. | Another full upload, analytics and community to run |
| Enforcement risk | One channel; a strike affects every language at once | Termination of any channel bars all of them. Suspensions can spread. "Same content across channels" can restrict features. |

---

## 3. Language priority (es, pt-br, hi, it, zh, ja)

### [unverified] 3.1 Chainalysis 2026 Global Crypto Adoption Index

- **Release and coverage:** released 2026-09-23; 117 countries; data for 2025-07-01 to 2026-06-30. The methodology was redesigned into four equally weighted pillars (service inflows, on-chain balances, domestic P2P activity, cross-border flows), so ranks are not comparable with earlier years.
- **Top 10:** Brazil, United States, Nigeria, Japan, South Korea, India, Ukraine, Thailand, South Africa, Canada.
- **Partial 11–20:** Germany 13, Indonesia 14, United Kingdom 17, Türkiye 20.
- **Brazil:** about $252.5 B of activity. Second in cross-border flows, third in service flows and P2P, fourth in balances.
- **Not found:** the 2026 ranks of Spain, Italy, Mexico, Argentina and Hong Kong/Taiwan.
- **Reliability:** cryptobriefing.com (read directly) confirms Brazil ahead of the US, Nigeria and Japan, plus Brazil's category ranks. The rest comes from consistent secondary summaries. chainalysis.com is blocked.

Sources: https://www.chainalysis.com/blog/2026-global-crypto-adoption-index/ (blocked) · https://cryptobriefing.com/brazil-first-chainalysis-crypto-adoption-index/ · https://statranker.org/digital-innovation/crypto-adoption-by-country-2026-chainalysis-top-20-ranking/ · https://incrypted.com/en/ukraine-ranked-seventh-in-global-cryptoasset-adoption-ranking-in-2026/ · https://indonesiacrypto.network/blog/indonesia-ranks-14th-in-global-crypto-adoption-in-2026
Source dates: index 2026-09-23; cryptobriefing read 2026-11-24.

### [unverified] 3.2 Previous edition (2025) for context

The 2025 top 10 was India, United States, Pakistan, Vietnam, Brazil, Nigeria, Indonesia, Ukraine, Philippines, Russia. India was first for the second year running. One Spanish-language source places Argentina 20th and Mexico 23rd in 2025.

Sources: https://www.theblock.co/post/369420/india-leads-global-crypto-adoption-chainalysis (403 here) · https://www.criptonoticias.com/comunidad/adopcion/5-paises-adopcion-bitcoin-criptomonedas-latinoamerica/
Source dates: 2025 edition (Sept 2025).

### [conflicting] 3.3 Chainalysis 2026 regional values: Spanish- and Portuguese-speaking markets

- **Latin America:** about $593.8 B (+9.8 %). Brazil $252.5 B, Argentina $88.5 B (+15.3 %), Mexico $77.6 B (+25.5 %, 81 % stablecoin-focused), Venezuela $39.1 B (+107.2 %), Colombia $29.1 B (+13.8 %). One Criptonoticias piece gives different figures (Argentina $93.9 B, Mexico $71.2 B, Venezuela $44.6 B), probably for another period.
- **Western Europe (report of 2026-11-09):** $2.08 T (+1.2 %). UK $424.5 B, Germany $288.8 B, France $215.8 B, Netherlands $207.8 B, **Spain $156.1 B (+24.6 %)**, Switzerland $132.8 B. Italy is not in the top six. Spain's registered exchanges drew more from other European countries than from Spanish users: cross-border inflows from Western Europe rose 79.1 %, led by inflows from Italy (+329 %) and Portugal (+751 %).
- **Analysis:** Spanish-speaking markets combined (Spain + Argentina + Mexico + Venezuela + Colombia ≈ $390 B) exceed Brazil alone ($252.5 B), but they are spread over many countries.

Sources: https://www.crowdfundinsider.com/2026/09/312875-brazil-tops-global-crypto-adoption-as-latin-america-grows-during-bear-market-research/ · https://www.mitrade.com/insights/news/live-news/article-3-2111001-20260924 · https://www.criptonoticias.com/comunidad/adopcion/5-paises-lideran-mercado-criptomonedas-latinoamerica-chainalysis/ · https://crypto.news/western-europes-crypto-economy-hits-2-08-trillion-as-stablecoin-use-surges/ (read directly)
Source dates: Chainalysis regional reports Sept–Nov 2026; crypto.news 2026-11-13.

### [unverified] 3.4 YouTube audience size (DataReportal "ad reach", which is not the same as users)

- India: 573 M (Oct 2026); 500 M in Digital 2026.
- Brazil: 154 M (Oct 2026); 150 M in Digital 2026.
- Mexico: 85–89.4 M.
- Japan: 78.5 M.
- Italy: about 41.2 M.
- Spain: 40.5 M.
- Argentina: 33.7 M.
- Colombia: 32.8 M.
- Taiwan, Hong Kong, Singapore: no sourced figure found.

DataReportal notes that ad reach "is not a direct proxy for metrics like monthly active users". datareportal.com is blocked, so all figures are via secondary pages.

Sources: https://datareportal.com/essential-youtube-stats (blocked) · https://sqmagazine.co.uk/how-many-people-use-youtube/ · https://tubestats.io/statistics/usage · https://air.io/es/audience-growth/which-countries-have-the-most-active-youtube-users-and-why-it-matters · https://www.kolsquare.com/it/blog/statistiche-youtube-dati-italiani-tendenze-e-strategie-per-influencer-marketing
Source dates: Digital 2026 (late 2025); Oct 2026 ad-reach tables.

### [conflicting] 3.5 CPM/RPM by market (directional only)

YouTube publishes no CPMs. Third-party estimates disagree widely:
- **Spain/Italy:** CPM about $1.50–4 (all niches). One source gives Spain an RPM of about $3–5.50.
- **Brazil:** CPM about $0.80–3; RPM about $0.80–2.
- **Mexico:** CPM about $0.80–2.50; RPM about $0.35.
- **India:** CPM about $0.30–1.50 (finance about $1–4); RPM about $0.30–1.20.
- **Japan:** RPM about $2.58; CPM $9–11.
- **Hong Kong:** CPM about $14–17; RPM about $4.4–5.5.
- **Taiwan:** CPM about $3.56.

Direction: HK, JP, ES, IT > TW > BR, MX > IN. Use the channel's own Analytics by audio track and geography instead, once there is data.

Sources: https://travelpayouts.com/blog/youtube-cpm-rates/ · https://fluxnote.io/guides/youtube-rpm-by-country · https://www.sozee.ai/resources/youtube-earnings-by-country/ · https://dynamoi.com/sv/data/youtube-adsense-rpm/jp · https://www.nicherpm.com/youtube-rpm-by-country · https://air.io/en/audience-growth/translating-youtube-metadata-into-asian-languages-why
Source dates: vendor pages, 2025–2026.

### [confirmed] 3.6 Crypto-exchange advertiser demand by market (Google Ads approved locations)

**Analysis:** where Google Ads cannot sell crypto-exchange ads, crypto content sees less finance-advertiser demand. This affects CPM, and it also governs branded content (§4.0).

Google Ads allows crypto-exchange (and in some places wallet) ads only in listed locations, with certification:
- **EU-27 (incl. Spain and Italy):** "as long as the advertiser is authorized as a Crypto-Asset Service Provider (CASP) under the Markets in Crypto-Assets (MiCA) regulation".
- **Argentina:** CNV-registered PSAVs.
- **Japan:** FSA-registered.
- **Hong Kong:** SFC type 1 and type 7 licences.
- **Others:** US, UK, Canada, South Korea, Switzerland, Israel, Philippines, South Africa, Thailand, UAE, Bahrain, Indonesia, Iceland, Liechtenstein, Norway.
- **Not listed:** Brazil, India, Mexico, Colombia, Taiwan, Singapore.

"Cryptocurrency educational materials" can be advertised without approval "provided the content does not offer investment advice, tips, odds, financial calculators, or technical trend analysis".

Sources: https://support.google.com/adspolicy/answer/14009787?hl=en
Source dates: read 2026-11-24.

### [confirmed] 3.7 Competition from YouTube's own auto-dubs

Every English-language crypto channel with auto-dubbing on is already available in es, pt, hi, it and ja. es, pt, hi and it get expressive speech; ja does not. English→Chinese does not exist (§1.9).

**Analysis:** our own dubs in es, pt-br, hi and it must beat a free, voice-matched auto-dub on accuracy, terminology, local examples and compliance. zh is the one target with no auto-dub competition from English channels.

Sources: https://support.google.com/youtube/answer/15569972?hl=en
Source dates: read 2026-11-24.

### Voice feasibility (owner decision and task brief; not re-tested here)

**Binding owner decision (2026-11-24, `CLAUDE.md`):** ZOO uses Kokoro **`im_nicola` in every language** (en, es, pt-br, hi, it, zh). The owner accepted the Italian accent. Only the phonemizer language code changes per track: `es`, `pt-br`, `hi`, `it`, `cmn`. Kokoro's native male voices (em_alex, pm_alex, hm_omega, jm_kumo, zm_yunjian) exist but are not used for ZOO.

| Language | Phonemizer | State |
| --- | --- | --- |
| it | it | Native for im_nicola, so the only dub without a foreign accent |
| es, pt-br | es, pt-br | Works; Italian accent (owner listened to samples on 2026-11-24 and accepted it) |
| hi | hi | Audio of untested quality |
| zh | cmn | Audio quality unknown |
| ja | ja | **Broken** through espeak: kanji are read as "Japanese letter" until a real G2P (misaki[ja]/pyopenjtalk) passes phonemes with `is_phonemes=True` |

French is excluded: Kokoro has no male voice. Devanagari and CJK need the Noto fonts.

**Analysis:** YouTube's expressive auto-dubs copy the original voice's pitch and intonation (§1.9). Compare our accented es and pt-br tracks with that baseline. After the first episodes, check retention by audio track in YouTube Analytics.

### Analysis 3.8: ranking

| Rank | Lang | Why | Main risks |
| --- | --- | --- | --- |
| 1 | es (Spain + LatAm) | Largest reachable audience after Hindi (MX 85–89 M, ES 40.5 M, AR 33.7 M, CO 32.8 M, plus US Hispanics, CL, PE, VE). Strong crypto activity (LatAm Spanish markets ≈ $234 B plus Spain $156 B; Venezuela +107 %, Mexico +25.5 %). Spain carries the higher CPM. Exchange advertisers can buy in Spain (MiCA CASPs) and Argentina. Owner's launch pick. | Spain vs. LatAm vocabulary (use neutral LatAm Spanish, no "vosotros"). Crowded Spanish crypto niche plus free expressive auto-dubs. MiCA rules for Spain; CNV registry for Argentina; mixed CPM. |
| 2 | pt-br (Brazil) | #1 in Chainalysis 2026 ($252.5 B). About 150–154 M YouTube ad reach. One country, one variant, so localization is simplest. Owner's launch pick. | Low-to-mid CPM. Google Ads does not allow exchange ads targeting Brazil. CONAR 2026 guide (affiliates, virtual influencers), CVM analyst rules, BCB VASP authorization. Free expressive pt auto-dubs. |
| 3 | hi (India) | Biggest YouTube market (500–573 M). #6 in 2026 (#1 in 2024–25). High scam exposure suits security content. | Lowest CPM. No Google crypto-exchange ads. Strict promotion rules (ASCI disclaimer, virtual-influencer disclosure, FIU blocking of offshore exchanges). Free expressive Hindi auto-dub. Much of India's crypto audience watches English or Hinglish, so pure Hindi may sound stilted (native reviewer needed). Needs Noto Sans Devanagari. |
| 4 | it (Italy) | One EU (MiCA) rulebook shared with Spain. Mid CPM. Exchange ads allowed for MiCA CASPs. ZOO's voice, im_nicola, is native Italian, so this is the only dub without a foreign accent. | Smallest audience (about 41 M); Italy not in Western Europe's top six by crypto value. Consob is active on finfluencers. Free expressive Italian auto-dub. |
| 5 | zh (TW, HK, SG, MY, diaspora) | No English→Chinese auto-dub, so less dub competition. Higher CPM in HK (and TW mid). HK has a licensed crypto market. | Mainland viewers unreachable (YouTube blocked) and crypto business illegal there. TW/HK read Traditional Chinese and HK speaks Cantonese, and im_nicola speaking Mandarin (espeak cmn) is of unknown quality. Strict promotion law in HK and SG, solicitation limits in TW. Needs both zh-Hant and zh-Hans metadata. |
| 6 | ja (Japan) | On market merits about #3: #4 in Chainalysis 2026, about 78.5 M reach, higher RPM, exchange ads allowed for FSA-registered firms. | **Blocked:** Kokoro ja needs a real G2P. Free (non-expressive) Japanese auto-dub can stand in. Stealth-marketing law; crypto moves under the FIEA (2026 amendment). |

---

## 4. Regional rules for affiliate/referral links and crypto promotion

### [confirmed] 4.0 YouTube rules that apply in every market

- **Paid promotion box:** "If you feature branded content, sponsorships, endorsements, or other commercial relationships in your videos, you have to let YouTube know by selecting the paid promotion button."
- **Branded content follows Google Ads policy:** "Your branded content must comply with YouTube's Community Guidelines and Google Ads policies, with some exceptions." So the crypto-exchange location list in §3.6 matters for sponsored crypto videos.
- **Per-country restrictions:** creators "can limit who gets to find your branded content based on their age or location". This is set in desktop Studio and only appears when Paid promotion = Yes.
- **Analysis:** with MLA, a geo restriction hits every language track of that video.
- US FTC and UK FCA rules for the English master are covered in `platform-facts-2026-11-23.md`. The UK FCA crypto promotion regime applies to UK viewers wherever the creator is.

Sources: https://support.google.com/youtube/answer/154235?hl=en · https://support.google.com/adspolicy/answer/14009787?hl=en
Source dates: read 2026-11-24.

### 4.1 India (hi)

#### [unverified] ASCI Guidelines for Advertising and Promotion of Virtual Digital Assets and Linked Services (in force for ads from 2022-04-01)

**Scope:** "All ads for VDA products and VDA exchanges, or featuring VDAs, must carry the following disclaimer". Under ASCI, an influencer post with a material connection, including an affiliate link, is an ad.

**Exact text:** "**Crypto products and NFTs are unregulated and can be highly risky. There may be no regulatory recourse for any loss from such transactions.**"

**Short version** where characters are limited: "**Crypto products and NFTs are unregulated and risky**", plus a link to the full disclaimer.

**Placement:**
- In the dominant language of the ad, meeting ASCI's general disclaimer standards.
- In video: at the end, on a plain background, with a voice-over at normal pace, on screen for at least 5 seconds.
- On social media: in the caption and in every picture or video attachment.
- Longer videos must repeat it at the start and the end. The threshold is `conflicting`: a law-firm summary says over 2 minutes; a 2026-hosted copy says over 10 minutes.

**Other rules:** the words "currency", "securities", "custodian" and "depositories" must not be used in VDA ads. People who appear in VDA ads must do due diligence.

ASCI publishes no official Hindi text of the disclaimer that was found. A Hindi rendering would need native review.

Sources: https://www.ascionline.in/wp-content/uploads/2022/09/vda-guidelines-press-release-feb-23.pdf (blocked; index extract) · https://www.khaitanco.com/sites/default/files/2026-03/ASCI%27s%20Guidelines%20for%20Advertising%20of%20Virtual%20Digital%20Assets%20and%20Linked%20Services.pdf · https://www.theblock.co/post/135142/india-crypto-ad-guidelines-asci · https://www.coindesk.com/policy/2022/02/23/indias-crypto-advertising-guidelines-are-out/
Source dates: guidelines 2022-02-23; copy hosted 2026-03.

#### [unverified] ASCI influencer guidelines: labels, virtual influencers, finfluencers

- **Labels:** ads need an upfront, prominent disclosure label.
- **Virtual influencers** ("fictional computer generated 'people' or avatars who have realistic characteristics, features and personalities of humans") "must additionally disclose to consumers that they are not interacting with a real human being".
- **Finfluencers:** since 2023, anyone giving investment advice must be SEBI-registered and show the registration number and qualifications. An April 2025 clarification allows general money topics without a licence.
- **Analysis:** ZOO is a flat 2D cartoon, but disclose "animated character, AI voice" whenever a hi video carries promotion.

Sources: https://www.ascionline.in/social/wp-content/uploads/2025/04/ASCI-Influencer-Guidelines.pdf (blocked) · https://www.infolawgroup.com/insights/2023/8/11/virtual-influencers-are-now-officially-regulated-endorsersunless-theyre-spokespersons · https://business-standard.com/management/news/asci-puts-more-onus-on-financial-health-influencers-in-new-ad-guidelines-123081700269_1.html · https://www.angelone.in/news/market-updates/asci-eases-rules-for-financial-and-health-influencers-but-sebi-regulations-still-apply
Source dates: 2021 guidelines, 2023 addendum, April 2025 version.

#### [unverified] Government endorsement guidance ("Endorsement Know-hows!", Consumer Protection Act 2019)

Released 2023-01-20 for "celebrities, influencers and virtual influencers". Use terms such as "advertisement", "sponsored", "collaboration" or "paid promotion", "clear, prominent, and extremely hard to miss", and do not bury them among hashtags or links. Endorse only after due diligence. A 2023-08 PIB text describes later guidelines as replacing the booklet in part.

Sources: https://consumeraffairs.nic.in/sites/default/files/PIB1892527.pdf · https://www.pib.gov.in/PressReleasePage.aspx?PRID=1904528 · https://en.vikaspedia.in/viewcontent/social-welfare/social-awareness/consumer-education/endorsements-know-hows
Source dates: 2023-01-20, 2023-03-06, 2023-08.

#### [unverified] Offshore exchanges: FIU-IND registration and takedowns

FIU-IND served notices on 15 offshore platforms (2026-09) and 25 (2025-10), and asked for their URLs and apps to be blocked. VDA service providers must register under the PMLA whether or not they have a presence in India.

**Analysis:** never link an exchange that is not FIU-registered in hi content.

Sources: https://crypto.news/india-targets-weex-blofin-woo-x-and-12-other-crypto-platforms/ · https://www.theblock.co/news/regulation/2026-09-09-india-seeks-takedowns-of-15-crypto-platforms-over-aml-compliance-413975 · https://techcrunch.com/2025/10/02/india-cracks-down-on-25-crypto-exchanges-including-bingx-lbank-coinw-over-compliance-failures/
Source dates: 2025-10, 2026-09-09.

### 4.2 Spain (es, Spain)

#### [unverified] The CNMV crypto-advertising circular was repealed; there is no national mandatory crypto warning now

CNMV **Circular 1/2024 of 2024-12-17 (BOE-A-2024-27149) repealed Circular 1/2022** on advertising crypto-assets as investments, effective **2024-12-28**. The stated reason: MiCA now regulates crypto advertising directly.

For reference only, the repealed warning was: "La inversión en criptoactivos no está regulada, puede no ser adecuada para inversores minoristas y perderse la totalidad del importe invertido." (`unverified`, historical). It also required notice to the CNMV before "mass campaigns" (≥100,000 people). Neither applies any more.

Sources: https://www.boe.es/diario_boe/txt.php?id=BOE-A-2024-27149 (blocked; index extract) · https://finreg360.com/alerta/la-cnmv-deroga-la-circular-sobre-publicidad-sobre-criptoactivos-ante-la-proxima-fecha-de-aplicacion-de-mica/ · https://www.bolsamania.com/noticias/criptodivisas/cnmv-deroga-circular-publicidad-criptos-entrada-vigor-mica--18398022.html
Source dates: Circular 1/2024 of 2024-12-17, effective 2024-12-28.

#### [unverified] CNMV finfluencer supervision (2026)

The CNMV published a second review of finfluencers on 2026-04-09 (about 100 profiles; it may require unauthorised activity to stop). On **2026-05-25** it published the guide "Finfluencers: cómo actuar con responsabilidad". The guide says:
- Promoting crypto needs a higher standard of diligence than ordinary consumer goods.
- Check that the promoted company is authorised before publishing.
- Do not spread false or misleading crypto information; MiCA market-abuse rules apply.
- A "this is not investment advice" disclaimer does not exempt the publisher.

One source dates the guide 2026-06-03 instead.

Sources: https://www.cnmv.es/DocPortal/Publicaciones/Guias/GuiaparaFinfluencers.pdf (blocked) · https://www.cuatrecasas.com/es/spain/propiedad-intelectual/art/cnmv-publica-guia-finfluencers · https://en.ara.cat/economy/the-cnmv-puts-finfluencers-under-the-spotlight-10-breach-investment-regulations_1_5703283.html
Source dates: 2026-04-09; 2026-05-25.

#### [conflicting] Influencer ad labels in Spain (Autocontrol code, in force 2025-10-01)

Valid labels: "publicidad", "publi", "en colaboración con", "colaboración pagada", "embajador de [marca]", "patrocinado por". Labels must be clear in the content's language. Platform tools such as YouTube's "incluye contenido promocional" are recommended. One source says the CNMC (the audiovisual regulator) rejects "colaboración con" and "colaboración pagada" as insufficient.

The **Real Decreto 444/2024** "usuarios de especial relevancia" regime (registration; aggregate ≥2,000,000 followers confirmed in extracts; other thresholds not verified) concerns large creators only.

Sources: https://www.cuatrecasas.com/es/spain/propiedad-intelectual/art/nuevo-codigo-conducta-publicidad-influencers-contenido-claves-practicas · https://www.kolsquare.com/es/blog/certificado-autocontrol-codigo-de-conducta-influencers · https://www.boe.es/eli/es/rd/2024/04/30/444 (blocked)
Source dates: code effective 2025-10-01; RD 2024-04-30.

### 4.3 European Union: MiCA (applies to es-ES and it audiences)

#### [unverified] Art. 7: marketing communications for crypto-asset offers and admissions to trading

Applies to tokens other than asset-referenced and e-money tokens; Art. 29 and Art. 53 cover those two. Marketing communications must:
- be clearly identifiable as such;
- be fair, clear and not misleading;
- be consistent with the white paper;
- state that a white paper has been published, and give the offeror's website address and contact details;
- carry the "clear and prominent" statement below (Art. 7(1)(e)).

Exact text: "**This crypto-asset marketing communication has not been reviewed or approved by any competent authority in any Member State of the European Union. The offeror of the crypto-asset is solely responsible for the content of this crypto-asset marketing communication.**"

Where the person seeking admission to trading or a platform operator prepares the communication, that party replaces "offeror". No marketing may be disseminated before the white paper is published.

The wording is checked against ESMA's Interactive Single Rulebook extracts and secondary copies, not against EUR-Lex (blocked). Use the official Spanish or Italian language version from EUR-Lex for es and it tracks; none was read here.

**Analysis:** the duty sits with the offeror, but a paid token promotion is the offeror's marketing communication. Without the offeror's white paper and this statement, do not run it.

Sources: https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica/article-7-marketing-communications (blocked; index extract) · https://www.springlex.eu/en/packages/mica/mica-regulation/article-7/ · https://gomica.eu/insights/mica-s-marketing-communications-provisions
Source dates: Regulation (EU) 2023/1114, OJ L 150, 2023-06-09; Title II applies from 2024-12-30.

#### [unverified] Art. 91: undisclosed holdings while "voicing an opinion" is market manipulation

Market manipulation includes "taking advantage of occasional or regular access to the traditional or electronic media by voicing an opinion about a crypto-asset" after taking a position and profiting from the price effect "without having simultaneously disclosed that conflict of interest to the public in a proper and effective way". The ban is not limited to activity on trading platforms. Penalties are set by member states.

**Analysis:** keep the existing "disclose holdings" script rule, in every language track.

Sources: https://www.esma.europa.eu/publications-and-data/interactive-single-rulebook/mica/article-91-prohibition-market-manipulation (blocked) · https://www.springlex.eu/en/packages/mica/mica-regulation/article-91/ · https://cointelegraph.com/news/mica-bill-contains-a-clear-warning-for-crypto-influencers
Source dates: MiCA 2023; Title VI applies from 2024-12-30.

#### [unverified] Only MiCA-authorised providers since 2026-07-01; influencer promotion of non-EU firms counts as solicitation

- **End of grandfathering:** ESMA's 2026-04-17 statement: the transitional periods end on **2026-07-01** at the latest. After that date only authorised CASPs may serve EU clients. Some states ended earlier (e.g., Austria on 2025-12-31).
- **Reverse solicitation:** a third-country firm may serve EU clients only at their own exclusive initiative (Art. 61). ESMA's guidelines (final report 2024-12-17; guidelines 2025-02-26) treat solicitation "by any other person acting explicitly or implicitly on behalf of the third-country firm", including influencers and affiliates, as the firm's own solicitation. That wording is from the consultation draft; secondary summaries confirm the final text.
- **Analysis:** in es and it tracks, link only exchanges authorised as CASPs under MiCA (check the ESMA register). Google Ads applies the same test (§3.6).

Sources: https://www.esma.europa.eu/sites/default/files/2026-04/ESMA75-113276571-1679_Statement_on_the_end_of_transitional_periods_under_MiCA.pdf (blocked) · https://cms.law/en/lux/legal-updates/end-of-the-micar-transitional-regime-on-1-july-2026-practical-impacts-for-vasps-and-their-customers · https://maples.com/regulatory-round-up/esma-reverse-solicitation-guidance-mica · https://legal.pwc.de/content/services/regcore-client-alert/micar-final-guidelines-on-reverse-solicitation.pdf
Source dates: 2024-12-17, 2025-02-26, 2026-04-17, 2026-07-01.

#### [unverified] ESMA finfluencer factsheet (January 2026)

National versions were published, including Spanish and Italian. Key points:
- Be honest and clear.
- Do not give personalised investment suggestions: they are investment advice, and "NFA" does not change that.
- Label paid partnerships as advertising.
- Disclose payments.

ESMA's technical advice on further EU finfluencer rules is due by 2027-10-01 (Skadden, 2026-10).

Sources: https://www.esma.europa.eu/sites/default/files/2026-01/ES_Spain_es_-_Finfluencers_factsheet.pdf (blocked) · https://www.esma.europa.eu/sites/default/files/2026-01/IT_Italy_it_-_Finfluencers_factsheet.pdf (blocked) · https://www.consob.it/web/consob-and-its-activities/w/press-release-of-12-january-2026-finfluencers- (blocked) · https://cointelegraph.com/news/italy-consob-esma-crypto-finfluencers-advertising-rules · https://www.skadden.com/insights/publications/2026/10/social-media-meets-financial-regulation
Source dates: factsheet 2026-01; Consob release 2026-01-12.

### 4.4 Italy (it)

#### [unverified] Consob (MiCA/finfluencers) and AGCOM (influencer code)

- **Consob** republished the ESMA finfluencer factsheet on **2026-01-12**. Press reports cite fines of up to €5 M for individuals; that figure was not checked against Consob's text.
- **AGCOM's Code of Conduct for influencers** (Delibera 197/25/CONS, 2025-07-23) applies to "influencer rilevanti": more than 500,000 followers, or more than 1 M views on the main platforms.
  - Those creators must register on AGCOM's list.
  - The code covers hidden advertising and requires content to be transparent and recognisable as advertising.
  - Sanctions follow art. 67 TUSMA; one source says up to €600,000.

**Analysis:** below those thresholds the general consumer-code ban on hidden advertising and the IAP Digital Chart labels still apply. The IAP chart was not researched here.

Sources: https://www.agcom.it/sites/default/files/provvedimenti/delibera/2025/197_25_cons_delibera.pdf (blocked) · https://www.agcom.it/sites/default/files/media/allegato/2025/197_25_cons_allegato%20B_codice.pdf (blocked) · https://www.teleborsa.it/DettaglioNews/17_2025-07-25_TLB/Influencer-Agcom-approva-Linee-guida-e-Codice-di-Condotta.html · https://coinpaprika.com/news/italy-warns-crypto-influencers-eu-rules-fines-5m/
Source dates: 2025-07-23; 2026-01-12.

### 4.5 Brazil (pt-br)

#### [unverified] CONAR "Guia de Marketing e Publicidade por Influenciadores Digitais" 2026

Published 2026-05-12, with effect from **2026-06-01**. It replaces the 2020/2021 guide.
- **Affiliates:** it expressly covers people paid per click, per sale or by other performance metrics. **Affiliate links count as advertising.**
- **Virtual characters:** the definition of influencer covers "perfis virtuais, avatares e personagens" with a commercial relationship.
- **Identification** must be "clara, ostensiva e imediata". One analysis says CONAR now prefers platform tools over "#publi"/"#publicidade".
- **AI:** "conteúdos, avatares e influenciadores virtuais criados com Inteligência Artificial devem ser transparentes". Sources disagree on whether this creates an AI-disclosure duty (`conflicting`).

CONAR is self-regulatory: no force of law, but CONAR can issue decisions against ads. No crypto-specific CONAR annex was found; Anexo X covers betting.

Sources: https://conar.wpenginepowered.com/wp-content/uploads/2026/05/260525_GUIA_INFLUENCIADORES_CONAR_v6.pdf (blocked) · https://www.legal500.com/intelligence/brazil/media-telecoms-it-entertainment/conar-atualiza-guia-de-publicidade-com-influenciadores · https://www.klalaw.com.br/conar-atualiza-guia-de-publicidade-com-influenciadores/ · https://www.contabeis.com.br/artigos/77061/conar-novas-regras-para-influenciadores-e-ia-a-partir-de-1o-de-junho/
Source dates: 2026-05-12, effective 2026-06-01.

#### [unverified] CVM: recommending securities makes you an "analista"; disclaimers do not cure it

Per a CVM study (2023):
- An influencer who recommends investments or shows a portfolio with forecasts is doing analysis subject to **Resolução CVM 20/2021**, which requires CVM accreditation.
- "Não se trata de recomendação de investimento" disclaimers are not enough.
- Using social media to create artificial demand, supply or price for securities is an offence even when done non-professionally.

A 2023 public consultation (SDM 04/2023) has not yet produced rules. Finfluencer supervision is on the CVM's 2026 regulatory agenda. These rules apply to tokens that are securities. Pure crypto falls under the Banco Central regime below.

Sources: https://www.gov.br/cvm/pt-br/centrais-de-conteudo/publicacoes/estudos/20230418-air-influenciadores.pdf/@@download/file (blocked) · https://blogs.correiobraziliense.com.br/servidor/cvm-esclarece-duvidas-sobre-influenciadores-digitais-que-recomendam-investimentos/ · https://capitalaberto.com.br/regulacao/2026/01/apos-regulatorio-intenso-em-2025-agenda-da-cvm-26-chama-atencao-sobre-influencers-e-fundos · https://www.bmalaw.com.br/en/content/corporate-and-ma/bma-review/bma-review-90/the-finfluencer-phenomenon-and-brazils-capital-market-paths-to-regulatory-modernization/pdf
Source dates: 2023-04-18; 2026-01; 2026-03.

#### [conflicting] Banco Central VASP authorisation regime

Resoluções BCB 519, 520 and 521 were published on 2025-11-10 and are in force from **2026-02-02**. They cover authorisation, operation, and the FX treatment of crypto-asset services. A 2026 CMN vote document mentions postponing "normas" to 2027; it is unclear whether that covers these resolutions. No VASP advertising rules were found.

**Analysis:** link only BCB-authorised providers once the register is public. Google Ads does not allow crypto-exchange ads targeting Brazil (§3.6).

Sources: https://agenciabrasil.ebc.com.br/economia/noticia/2025-11/banco-central-estabelece-regras-para-o-mercado-de-criptoativos · https://www.mattosfilho.com.br/unico/normas-regulamentacao-ativos-virtuais/ · https://normativos.bcb.gov.br/Votos/CMN/20267/Voto_do_CMN_7_2026.pdf (blocked)
Source dates: 2025-11-10; 2026.

### 4.6 Mexico and Latin America basics (es, LatAm)

#### [unverified] Argentina: the CNV PSAV registry reaches social-media advertising aimed at residents

CNV Resolución General 994/2024 (2024-03-25) created the PSAV registry under Ley 27.739. The registry covers firms that use websites, social networks or other channels to direct offers or advertising to Argentine residents. RG 1025/2024 adds custody, cybersecurity and client-referral rules. No PSAV ad-warning text was found. Google Ads allows exchange ads targeting Argentina only for CNV-registered PSAVs (`confirmed`, §3.6).

Sources: https://www.argentina.gob.ar/normativa/nacional/norma-397598/texto (blocked) · https://www.boletinoficial.gob.ar/detalleAviso/primera/305110/20240325 (blocked) · https://www.argentina.gob.ar/node/445852 (blocked)
Source dates: 2024-03-25; 2024.

#### [unverified] Mexico: no crypto-specific influencer or advertising rule found

Crypto falls under the Ley Fintech (2018; a commercial blog reports a reform published 2025-11). The CNBV and Banxico supervise; Banxico remains cautious (financial-stability report, 2025-12-10). No PROFECO or CONDUSEF crypto-ad rule was found. General consumer-protection law bans misleading advertising (LFPC; not read here). Google Ads does not approve crypto-exchange ads targeting Mexico (`confirmed`, §3.6).

Sources: https://www.mercadopago.com.mx/blog/regulacion-criptomonedas-mexico · https://www.bloomberglinea.com/latinoamerica/mexico/banxico-mantiene-cautela-con-criptomonedas-pese-al-cambio-global/ · https://www.xataka.com.mx/criptomonedas/mexico-regulo-a-fintech-muchos-paises-ahora-criptomonedas-su-gran-pendiente
Source dates: 2025-12; 2026.

#### [unverified] Colombia: SIC influencer guide plus the consumer statute

The SIC's "Guía de buenas prácticas en la publicidad a través de influenciadores" (2020, later edition 2022) applies with Ley 1480 de 2011 (Estatuto del Consumidor). Paid content must be identified as advertising. Fines run up to 2,000 monthly minimum wages. Reports from July–August 2026 say the SIC is updating its guidance. No crypto-specific rule was found.

Sources: https://sedeelectronica.sic.gov.co/international-relations/sic-publishes-influencer-advertising-good-practices-guide (blocked) · https://www.asuntoslegales.com.co/consumidor/las-reglas-que-plantea-la-superintendencia-de-industria-y-comercio-para-los-influencers-3062632 · https://www.asuntoslegales.com.co/consumidor/hasta-2-000-salarios-deben-pagar-los-influencers-que-violan-el-codigo-del-consumidor-3623947
Source dates: 2020/2022; 2026-08.

### 4.7 China, and where the zh audience actually is

#### [unverified] YouTube has been blocked in mainland China since 2009

YouTube works normally in Hong Kong, Macau and Taiwan. A zh track therefore reaches Taiwan, Hong Kong, Singapore, Malaysia and the diaspora, not mainland viewers.

Sources: https://www.wikipedia.org/wiki/Blocking_of_YouTube · https://gizmodo.com/best-vpn/unblock-youtube-china · https://en.greatfire.org/domain/youtube.it
Source dates: 2026 coverage.

#### [unverified] PBoC-led Notice No. 42 [2026] (2026-02-06)

- **All crypto business is illegal:** "virtual currency-related business activities" are illegal financial activity, including exchange, trading, market-making, information intermediation and token issuance.
- **RWA tokenisation** is banned onshore without approval. Offshore entities must not serve mainland users.
- **Internet platforms** may not provide "online business venues, commercial displays, marketing, traffic-buying or paid promotion" for crypto or RWA services.
- **Marketing agents and influencer promoters** serving such projects for Chinese users face liability.
- The notice repeals the 2021 notice (Yinfa No. 237) according to crypto.news (read directly) and a Hankun law-firm note. One summary could not confirm the repeal.

Sources: https://crypto.news/china-formalizes-sweeping-ban-on-crypto-trading-and-rwa-tokenization/ · https://hankunlaw.com/en/portal/article/index/cid/8/id/16265.html · https://www.reedsmith.com/articles/china-s-new-regulatory-framework-on-rwa-tokenisation-stablecoins-and-other-virtual-currency-activities/ · https://en.people.cn/n3/2026/0207/c90000-20423620.html
Source dates: 2026-02-06.

#### [unverified] Hong Kong: stablecoin advertising offence; influencer liability precedent

- **Stablecoins Ordinance (Cap. 656), in force 2025-08-01:** s.10 makes it an offence to advertise a regulated stablecoin activity or offer unless licensed or exempt. Penalty: level 5 fine (HK$50,000) and 6 months' imprisonment.
- **JPEX precedent:** in 2023 the SFC said the unlicensed exchange JPEX promoted itself through paid influencers, and influencers were among those arrested (on suspicion of conspiracy to defraud).
- **Exchange ads:** Google Ads requires SFC type 1 and type 7 licences for crypto-exchange ads targeting HK (`confirmed`, §3.6).
- **Not verified:** the AMLO "actively market" provision for unlicensed VA exchanges.

Sources: https://www.legco.gov.hk/yr2025/chinese/ord/2025ord017-c.pdf (blocked) · https://www.hkma.gov.hk/eng/news-and-media/press-releases/2025/05/20250521-3 · https://www.morganlewis.com/pubs/2025/06/hong-kongs-stablecoins-ordinance-to-take-effect-august-1-an-overview-of-the-regulatory-framework · https://hongkongfp.com/2023/09/18/social-media-influencers-among-6-arrested-as-hong-kong-police-probe-unlicensed-jpex-crypto-exchange/
Source dates: 2025-08-01; 2023-09.

#### [unverified] Singapore: crypto providers may not market through influencers

MAS Guidelines PS-G02 (2022-01-17): digital-payment-token service providers "should not engage in marketing or advertising of DPT services through the engagement of third parties, such as social media influencers, to promote DPT services to the general public in Singapore". They may advertise only on their own websites, apps and official social accounts. The guidelines are not legally binding, but MAS supervises against them. Amendments after 2022 were not checked.

**Analysis:** no exchange affiliate deals aimed at Singapore.

Sources: https://www.mas.gov.sg/news/media-releases/2022/mas-issues-guidelines-to-discourage-cryptocurrency-trading-by-general-public (blocked) · https://insightplus.bakermckenzie.com/bm/banking-finance_1/singapore-new-mas-guidance-restricts-public-marketing-of-cryptocurrencies · https://techinsights.linklaters.com/post/102hh8v/singapore-sets-pragmatic-guardrails-on-crypto-advertising-to-the-public
Source dates: 2022-01-17.

#### [unverified] Taiwan: unregistered foreign VASPs may not solicit

The FSC's guidelines of 2023-09-26: "Foreign virtual asset platform operators that have not registered under the company laws and have not declared compliance with anti-money laundering regulations to the FSC may not solicit business within Taiwan or target Taiwanese nationals." VASPs must join the VASP association. A dedicated Virtual Asset Service Act (draft 2025) was still under Executive Yuan deliberation as of mid-2026. No KOL-specific rule was found.

Sources: https://www.theblock.co/amp/post/252915/taiwan-releases-guidelines-for-crypto-exchanges-restricts-offshore-exchanges-unless-compliant · https://chambers.com/practice-guides/guides/blockchain-crypto-assets-2026/taiwan/law-and-practice · https://cointelegraph.com/news/taiwan-bans-operation-unregistered-foreign-crypto-exchanges
Source dates: 2023-09-26; 2026.

### 4.8 Japan (ja), for completeness

#### [unverified] Japan: stealth-marketing ban, and crypto moving under the FIEA

- **Stealth marketing:** since **2023-10-01**, undisclosed advertising is an "improper representation" under the Act against Unjustifiable Premiums and Misleading Representations (Cabinet Office Notification No. 19 of 2023). Influencer cases have been enforced. The exact label wording ("広告", "PR") was not verified.
- **FIEA amendment:** passed the Diet on **2026-07-15**. Crypto moves from the Payment Services Act to the FIEA, adding insider-trading rules. Expected effect within a year, around FY2027.
- **Exchange ads:** Google Ads requires FSA registration (`confirmed`, §3.6).

Sources: https://www.dlapiper.com/en/insights/publications/2023/07/consumer-protection-in-japan-new-law-prohibits-stealth-marketing · https://www.japantimes.co.jp/news/2023/03/28/national/stealth-marketing-rules/ · https://www.theblock.co/news/regulation/2026-07-15-japan-passes-key-bill-408361 · https://crypto.news/japan-passes-law-recognizing-crypto-as-financial-products/
Source dates: 2023-10-01; 2026-07-15.

### Analysis 4.9: what the rules mean for dubbed videos

- **Language is not country.** One es track serves Spain (MiCA), Argentina (CNV), Mexico (no regime) and US Hispanics (FTC). One zh track serves HK, SG and TW, all strict.
  - Until a geo-aware link router exists, **put no exchange or affiliate links and no token promotion in dubbed videos or their localized descriptions**.
  - The current pilot CTA is "subscribe only", which fits.
  - Own products (e.g., a security checklist) still need the paid-promotion box and disclosure.
- **Shared on-screen text under MLA.** ASCI (on screen ≥5 s plus voice-over, in the ad's language) and the FTC (spoken and on screen) cannot both be met per language by one master picture. Two options:
  - promotional videos are native per-language uploads (`mode: 'native'`); or
  - the master carries a stacked multilingual disclosure card while each track speaks its own language.
- **Localized descriptions** are per language. Put each language's disclosure text there, plus the English one in the default description.
- **Claim checker, per language:**
  - no return promises, price predictions or "buy" calls;
  - "not financial advice" is never treated as a shield (CVM, CNMV and ESMA all say it is not);
  - disclose holdings (MiCA Art. 91);
  - for hi VDA ads, block the ASCI-banned words "currency", "securities", "custodian" and "depositories";
  - never present ZOO as a human financial expert (YouTube's AI-persona policy).
- **Translations** stay "machine translation: needs native review" until the owner confirms. The reviewer checks meaning, register, compliance text and the AI-persona framing.

---

## Known gaps, and hosts to allow before relying on `unverified` items

- **Not found:**
  - the 2026 Chainalysis ranks of Spain, Italy, Mexico, Argentina, Hong Kong and Taiwan;
  - YouTube ad-reach figures for Taiwan, Hong Kong and Singapore;
  - any official per-language CPM;
  - which language variants Studio offers for dub tracks;
  - which audio formats dub uploads accept;
  - how Test & Compare interacts with localized thumbnails;
  - any official Hindi text of the ASCI disclaimer;
  - the official Spanish, Italian and Portuguese wording of the MiCA Art. 7 statement;
  - Banco Central VASP advertising rules;
  - Hong Kong's AMLO "actively market" provision;
  - the IAP Digital Chart labels;
  - Mexico's LFPC text.
- **Not tested:** uploading a Kokoro full-mix dub to Studio to see whether it is accepted and how close "roughly the same length" must be.
- **Hosts to allow** to promote items to `confirmed`:
  - www.chainalysis.com, datareportal.com
  - www.ascionline.in, consumeraffairs.nic.in, www.pib.gov.in
  - www.boe.es, www.cnmv.es
  - eur-lex.europa.eu, www.esma.europa.eu
  - www.consob.it, www.agcom.it
  - www.gov.br, www.conar.org.br, conar.wpenginepowered.com, normativos.bcb.gov.br
  - www.argentina.gob.ar, www.boletinoficial.gob.ar, sedeelectronica.sic.gov.co
  - www.pbc.gov.cn, www.legco.gov.hk, www.hkma.gov.hk, www.mas.gov.sg, www.fsc.gov.tw
  - www.caa.go.jp
- **Tooling:** WebFetch could not resolve any host in this session. Use curl through the proxy for allowlisted hosts.
