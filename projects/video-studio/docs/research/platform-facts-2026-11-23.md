# Platform facts fact-check — 2026-11-23

Verified by 7 research agents plus 1 cross-check agent. Each claim was checked against primary sources where this session could reach them.

**Limits.** This session's network blocks support.google.com, developers.google.com, www.remotion.dev, elevenlabs.io, sec.gov and ftc.gov. Claims marked `unverified` rest on search-index extracts of those official pages, not on a direct read. Re-check those before relying on them. Remotion facts come from the official `remotion-dev/remotion` repo source (docs at main, 2026-11-23) and the npm registry.

Status key: `confirmed` = primary source read; `corrected` = the original claim was wrong, and the correct fact is given; `conflicting_sources` = official pages disagree; `unverified` = no primary source could be read.

## Cross-check corrections (these override the researcher text below)

- Researcher 5 (privacy lock): the reversal does not rest only on the revision history and a third-party PR. Google's own discovery document (live rev 20261123) states it, and the text first appears at rev 20261012. The default privacy when the field is omitted is PUBLIC. The uploader must always send status.privacyStatus explicitly (e.g. 'private'), then read the value back from the response.
- Researcher 2 (thumbnails): the 50 MB limit is in the API discovery doc only from rev 20260709 (July 2026). It was 2 MiB through rev 20260707, so 'late 2025' is not supported for the API. API uploads accept only JPEG/PNG (image/jpeg, image/png, octet-stream), so GIF is out regardless of which Help-page version is current.
- Researcher 5 (thumbnails): the 'under 2 MB' target is outdated for the API (maxSize is now 52428800 bytes). Staying under 2 MB is still a reasonable conservative choice if anyone uploads from Studio on a phone.
- Researcher 5 (scopes): youtube.upload covers both videos.insert and thumbnails.set, not only insert. videos.update and playlistItems.insert need youtube or youtube.force-ssl. captions.insert needs youtube.force-ssl or youtubepartner.
- Researcher 3 said 'No official YouTube text addressing a creator's own product'. This is contradicted by an index extract of support.google.com/youtube/answer/154235: 'Endorsements are content created for an advertiser (or for a creator's own brands if the relationship between creator/brand is not clear)'. The same page also says 'This policy doesn't apply to videos created by or for brands and uploaded to the brand's YouTube channel.' Researcher 4's reading is the better-supported one. On a personal channel, check the paid-promotion/branded-content box for own-product videos.
- Researcher 4 marked the meme-coin text of SEC Release 33-11412 as 'confirmed', but sec.gov was never read. Downgrade it to unverified (existence and date are well corroborated). Researcher 4 also treats the 2025-02-27 staff statement as current posture, but law-firm summaries say the March 2026 release supersedes prior staff statements on the topics it covers. Cite 33-11412 (FR Doc. 2026-05635, 2026-03-23) as the controlling SEC interpretation, not the 2025 staff statement.
- Researcher 4's gambling analysis covers only the 2025-03-19 rule. It omits the Nov 17, 2025 expansion to gambling with skins, cosmetics and NFTs, which Researcher 3 cites and secondary press corroborates. Both rules apply. General NFT discussion is reportedly not affected.
- Researcher 6's ElevenLabs Starter price conflict ($6 vs $5) probably reconciles as $6/month on monthly billing and about $5/month on annual billing (annual = monthly x 10). It is still unconfirmed against the live page. Budget $6/month.
- Researcher 1 lists the npm dist-tag alpha = 4.1.0-alpha12. That tag was published 2023-08-06 and is stale. It is not a preview of Remotion 5 and should be ignored.
- Researcher 5's videos.insert cost: do not budget 1600 units per upload. Official index extracts of the insert reference and the audits page say 1 unit from a separate Video Uploads bucket, capped at 100 calls/day/project. The 1600 figure survives only on the Quota Calculator page. This stays conflicting until developers.google.com can be read directly.
- Researcher 2's statuses for every YPP, Shorts, end-screen, chapter and loudness claim stay 'unverified' (index extracts only). Several of these, such as end screens (5-20 s, video at least 25 s) and chapters (00:00 start, at least 3 timestamps, at least 10 s each), are long-standing and match each other across researchers, but no researcher read the pages directly.

## Known gaps (not researched or not verifiable here)

- Network access blocked verification of most primary sources this session. The hosts that must be allowed in the session network settings to promote 'unverified' items to 'confirmed' are: support.google.com, developers.google.com, blog.youtube, blog.google, elevenlabs.io, help.elevenlabs.io, sec.gov, ftc.gov, federalregister.gov, govinfo.gov, ecfr.gov, creativecommons.org, www.remotion.dev and huggingface.co. At render time, the pipeline itself also needs remotion.media and storage.googleapis.com (browser download), plus fonts.gstatic.com if @remotion/google-fonts is used.
- No researcher covered YouTube's recommended upload encoding settings (Help answer 1722171: container, codec, bitrate per resolution and frame rate, color space, audio sample rate and channel layout). These are needed to set the Remotion/ffmpeg render profile for the long-form 16:9 and Shorts 9:16 outputs.
- Music sourcing is unresolved. The YouTube Audio Library terms (monetization, attribution string, use off YouTube) are unverified. No alternative royalty-free source (e.g. Pixabay Content License, Free Music Archive CC tracks, CC0 libraries) or AI-generated music license was checked. Content ID exposure for any chosen track is unknown.
- Trademark and brand-asset use was not researched: Solana, Pump.fun, Telegram, exchange or DEX logos in thumbnails and animations, and those organisations' brand guidelines. This matters together with YouTube's Impersonation and 'malicious clickbait' rules.
- Privacy in demo footage was not researched. Screen recordings of the Telegram bot or the AI-agent platform may show real users' handles, chat IDs, wallet addresses or messages. YouTube privacy guidelines and data-protection law (e.g. GDPR if any EU users) were not covered. The plan should be to use synthetic demo data.
- The primary text of SEC Release 33-11412 (meme coins as 'digital collectibles', investment-contract 'separation', supersession of staff statements) was not read. Neither was the proposed 'Regulation Crypto Assets' (33-11434) or the CLARITY Act status. Counsel review of memecoin promotion is still needed.
- Non-US marketing rules for the memecoin were not verified: EU MiCA Art. 7 marketing communications and white-paper requirements, and whether a Pump.fun memecoin is a UK FCA 'qualifying cryptoasset'.
- The ElevenLabs Prohibited Use Policy wording on financial or crypto promotional content, whether commercial rights persist after cancellation, and whether eleven_v4 returns non-null alignment on /with-timestamps were all left unverified or untested. A test call is needed before committing to the model.
- Google OAuth details for an unverified app moved to 'In production' with YouTube scopes were not checked against primary docs: whether YouTube scopes are classed as sensitive, the user cap, and the warning screen. Neither was the 7-day refresh-token expiry in 'Testing' (Researcher 5's sources were index-only).
- The reported 2026-11-16 change to paidProductPlacementDetails.hasPaidProductPlacement (no default false) and any pilot gating are unconfirmed. The pipeline should keep a manual Studio paid-promotion step until a test upload shows the field is accepted and persists.
- Content ID handling of 1-3 minute Shorts is unresolved (blocked globally vs. not auto-blocked from 2026-09-24). So is the current wording and placement of the YouTube 'AI use'/GenAI label after the May 2026 update. Both rest on conflicting index extracts.
- No one verified YouTube's clickable-external-links requirement (whether links in video descriptions need 'advanced features'). Researcher 4 cites it from an index extract only. It affects how the Telegram bot and platform links are surfaced.
- Remotion 5.0 release timing is unknown and its breaking changes are already documented on main. The project pins 4.0.541 while latest is 4.0.546. An upgrade policy, and a re-check of license eligibility (the headcount rule counts contractors and co-owning partners across all three ventures if they share the Remotion repo), should be settled before the first published video.

## Re-verified by the cross-check agent

### [confirmed] YouTube Data API: videos uploaded by unverified API projects are locked to private (2020 rule). Researcher 5 says this was reversed on 2026-11-02.

Reversed. The live discovery document (revision 20261123, read directly on 2026-11-23) gives VideoStatus.privacyStatus this description: "In a `videos.insert` request, if you don't specify a value for this property, the uploaded video's privacy status defaults to `public`. Certain uploads might default to `private` based on creator account settings ... Videos uploaded from unverified API projects are not restricted to private viewing mode." In Google's own discovery snapshots mirrored in googleapis/google-api-go-client, the text first appears at revision 20261012 (v0.304.0). At revision 20261001 (v0.303.0) and in every earlier copy checked back to 20240926, the description is only "The video's privacy status." publishAt reads: "It can be set only if the privacy status of the video is private." Consequence: a videos.insert that leaves out privacyStatus publishes the video PUBLICLY.

Sources: https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest · https://raw.githubusercontent.com/googleapis/google-api-go-client/v0.303.0/youtube/v3/youtube-api.json · https://raw.githubusercontent.com/googleapis/google-api-go-client/v0.304.0/youtube/v3/youtube-api.json

Source dates: Live discovery rev 20261123, fetched 2026-11-23. go-client snapshots rev 20261001 (text absent) and 20261012 (text present). The revision-history entry dated 2026-11-02 could not be read because developers.google.com is blocked.

### [corrected] Thumbnail size limit: 1280x720 / 2 MB (Researcher 5) vs. 3840x2160 / 50 MB 'from late 2025' (Researcher 2)

In Google's discovery document, the thumbnails.set mediaUpload maxSize was 2097152 bytes (2 MiB) through rev 20260707 (go-client v0.288.0). It became 52428800 bytes (50 MiB) at rev 20260709 (v0.289.0) and is still 52428800 at the live rev 20261123. On the API side the 50 MB limit therefore dates from about July 2026, not late 2025. Accepted upload types are image/jpeg, image/png and application/octet-stream. GIF is not listed, so the JPG/GIF/PNG vs JPG/PNG conflict does not matter for API uploads. Endpoint: POST https://youtube.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=..., with a resumable path at /resumable/upload/youtube/v3/thumbnails/set. The Help page's 3840x2160 recommendation and its 2 MB limit for mobile uploads could not be read (support.google.com is blocked) and remain unverified.

Sources: https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest · https://raw.githubusercontent.com/googleapis/google-api-go-client/v0.288.0/youtube/v3/youtube-api.json · https://raw.githubusercontent.com/googleapis/google-api-go-client/v0.289.0/youtube/v3/youtube-api.json

Source dates: Discovery rev 20260707 = 2 MiB; rev 20260709 onward = 50 MiB; live rev 20261123.

### [conflicting_sources] videos.insert quota cost: 1600 units vs ~100 units vs 1 unit in a separate 'Video Uploads' bucket capped at 100 calls/day

The official pages could not be opened (developers.google.com is blocked). Search-index extracts of three official pages disagree. (a) The videos.insert reference page says "Quota impact: 100 calls per day. A call to this method has a quota cost of 1 unit in the Video Uploads quota bucket." (b) The Quota and Compliance Audits page says "default quota allocation of 100 search.list calls, 100 videos.insert calls, and 10,000 units per day combined for all other endpoints." (c) The Quota Calculator says "videos.insert has the highest cost of 1600 points." Indirect corroboration of the June 2026 quota overhaul from a primary source: videos.batchGetStats, introduced in the same revision-history batch, is missing from discovery rev 20260205 and present from rev 20260604. The discovery document carries no quota figures. Best reading: 1600 is stale. The binding limit is 100 uploads per day per project, plus the channel's unpublished 24-hour upload cap. Check the project's Cloud Console Quotas page.

Sources: https://developers.google.com/youtube/v3/docs/videos/insert · https://developers.google.com/youtube/data/guides/quota_and_compliance_audits · https://developers.google.com/youtube/v3/determine_quota_cost · https://raw.githubusercontent.com/googleapis/google-api-go-client/v0.270.0/youtube/v3/youtube-api.json · https://raw.githubusercontent.com/googleapis/google-api-go-client/v0.284.0/youtube/v3/youtube-api.json

Source dates: developers.google.com pages were seen only as search-index extracts on 2026-11-23. batchGetStats appears in discovery rev 20260604 (read directly).

### [unverified] paidProductPlacementDetails.hasPaidProductPlacement can be set through the API; since 2026-11-16 it reportedly 'no longer defaults to false' and may be pilot-gated

Confirmed from the live discovery doc (rev 20261123): Video.paidProductPlacementDetails exists as VideoPaidProductPlacementDetails {hasPaidProductPlacement: boolean}, described as "Details about paid content, such as paid product placement, sponsorships or endorsement ... This data can only be retrieved by the video owner." The field description has not changed since at least rev 20240926. The discovery doc says nothing about a default value, mutability, or pilot/launch-partner gating. The reported 2026-11-16 default change and the 'select launch partners / GA 2027' restriction could not be checked against a primary source. Send the field explicitly, and keep a manual 'Paid promotion' checkbox step in Studio as a fallback.

Sources: https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest · https://raw.githubusercontent.com/googleapis/google-api-go-client/v0.200.0/youtube/v3/youtube-api.json

Source dates: Discovery rev 20240926 and rev 20261123 (identical field description).

### [confirmed] OAuth scopes needed for the upload pipeline (youtube.upload alone is not enough)

From the live discovery doc (rev 20261123): videos.insert (POST youtube/v3/videos) and thumbnails.set (POST youtube/v3/thumbnails/set) accept youtube, youtube.force-ssl, youtube.upload or youtubepartner. videos.update (PUT youtube/v3/videos) and playlistItems.insert accept youtube, youtube.force-ssl or youtubepartner, but NOT youtube.upload. captions.insert accepts only youtube.force-ssl or youtubepartner (captions mediaUpload maxSize 104857600). videos.insert query parameters: part, notifySubscribers, autoLevels, stabilize, onBehalfOfContentOwner, onBehalfOfContentOwnerChannel. videos.insert maxSize is 274877906944 bytes (256 GiB); the resumable path is /resumable/upload/youtube/v3/videos. VideoStatus has selfDeclaredMadeForKids (bool), madeForKids (bool) and containsSyntheticMedia (bool, "Indicates if the video contains altered or synthetic media"; absent at rev 20240926, present from rev 20250714 onward).

Sources: https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest · https://raw.githubusercontent.com/googleapis/google-api-go-client/v0.250.0/youtube/v3/youtube-api.json

Source dates: Discovery rev 20261123, read 2026-11-23.

### [confirmed] Remotion is free for individuals and for-profit companies with up to 3 employees; Company License pricing; latest version and Node minimums

LICENSE.md (main, read 2026-11-23) lists Free License eligibility as: "an individual"; "a for-profit organization with up to 3 employees"; non-profits; evaluation. It adds: "In Remotion 5.0, the license will slightly change." The License FAQ says "an organization or team of individuals with up to 3 people", "as long as your total headcount is 3 or less", and "If you are eligible for the Free License, you can also run an automation." The v5.0 Terms #TeamSize section says a Company License is required when "the combined total headcount of all involved parties ... is 4 or more", that headcount means "all personnel, regardless of whether they use the Remotion Software", and that the aggregation "equally extends to ... part-time employees or ... independent contractors". A party that only receives the MP4 does not count. Prices: Remotion for Creators is $25 per Seat per month with no minimum. Remotion for Automators is $0.01 per render, "charged in increments of 1000 renders (i.e., $10)", with a $100/month minimum. Enterprise has a $500/month minimum. npm: remotion latest = 4.0.546 (published 2026-11-23T09:33:13.803Z). The local project at /home/user/buildwithAAI/projects/video-studio/package.json pins 4.0.541. In source, ENABLE_V5_BREAKING_CHANGES = false and MIN_NODE_VERSION = v5 ? 22 : 16. The skills CLI (1.7.0 and 1.9.0) declares engines node >=22.20.0, license MIT.

Sources: https://raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md · https://raw.githubusercontent.com/remotion-dev/remotion/main/packages/docs/docs/license/faq.mdx · https://raw.githubusercontent.com/remotion-dev/remotion/main/packages/docs/docs/terms.mdx · https://registry.npmjs.org/remotion · https://raw.githubusercontent.com/remotion-dev/remotion/main/packages/core/src/no-react.ts · https://raw.githubusercontent.com/remotion-dev/remotion/main/packages/core/src/v5-flag.ts · https://registry.npmjs.org/skills

Source dates: GitHub main and npm registry, read 2026-11-23. terms.mdx is titled 'Terms and Conditions of Remotion (v5.0)' (upcoming).

### [unverified] YPP ad-revenue entry thresholds rise on Feb 1, 2027 to 1,000 subs + 8,000 watch hours/365 days or 20M Shorts views/90 days

No primary page could be read: blog.youtube, blog.google and support.google.com are all blocked (ENOTFOUND). Several independent secondary outlets (Tubefilter 2026-08-10, The Next Web, Search Engine Journal, Hypebeast 2026-08, Shacknews, Notebookcheck) and an indexed Google regional blog post (blog.google/intl/en-mena) consistently report the following. From 2026-02-01... correction, from 2027-02-01, new applicants need 1,000 subscribers plus either 8,000 qualified watch hours in 365 days or 20M qualified Shorts views in 90 days. Existing partners keep their status but must accept the updated terms by Jan 31, 2027. Separately, a channel earns from the Shorts Creator Pool only if it has 10M qualified Shorts views in the prior 90 days; the 20M figure applies to entry, the 10M figure to Shorts payouts. Fan funding and Shopping thresholds are unchanged. This agrees with Researcher 2's extract, but it is secondary-corroborated only.

Sources: https://blog.youtube/news-and-events/youtube-partner-program-updates-2027-new-opportunities-earn/ · https://blog.google/intl/en-mena/product-updates/connect-communicate/new-opportunities-to-earn-and-changes-to-the-youtube-partner-program/ · https://www.tubefilter.com/2026/08/10/youtube-partner-program-ad-eligibility-requirements-shorts/amp/ · https://thenextweb.com/news/youtube-partner-program-doubles-entry-requirements-2027

Source dates: Announcement dated 2026-08-10, effective 2027-02-01. Official pages seen only as search-index entries; blog.google fetch failed (ENOTFOUND).

### [unverified] Contradiction: Researcher 3 says no official YouTube text addresses promoting your own product; Researcher 4 quotes answer/154235 as covering 'a creator's own brands'

A separate search-index extract of support.google.com/youtube/answer/154235 supports Researcher 4. It reads: "Endorsements are content created for an advertiser (or for a creator's own brands if the relationship between creator/brand is not clear) with a message that users are likely to believe reflects the opinions of the content creator." It also reads: "This policy doesn't apply to videos created by or for brands and uploaded to the brand's YouTube channel." and "You and the brands that you work with are responsible for understanding and complying with local and legal obligations to disclose paid promotion." In practice: on the creator's personal channel, where viewers may not realise the creator owns the bot, platform or token, check the paid-promotion/branded-content box. On a channel that is clearly the product's own brand channel, the policy says it does not apply. The page could not be opened directly (support.google.com is blocked).

Sources: https://support.google.com/youtube/answer/154235?hl=en · https://support.google.com/youtube/answer/17596007?hl=en

Source dates: Search-index extract, 2026-11-23. The page was not loaded directly.

### [unverified] YouTube gambling rules: Researcher 4 cites only the 2025-03-19 rule (no directing viewers to uncertified gambling sites); Researcher 3 cites a 2025-11-17 change covering crypto/NFTs

Both are real and they are separate changes. Secondary reporting (Tubefilter 2025-10-30, SBC Americas 2025-11-05, Decrypt, Kotaku) describes an update announced around 2025-10-28 and effective 2025-11-17. It extends the online-gambling rules to items with monetary value, such as video game skins, cosmetics and NFTs: content may not direct viewers to gambling sites or apps that use those items. It builds on the March 2025 rule. After creator pushback, YouTube clarified that showing NFTs or skins and general NFT discussion are not affected. Researcher 4's analysis leaves out the November 2025 expansion. The primary Help page or Community Guidelines update could not be read.

Sources: https://www.tubefilter.com/2025/10/30/youtube-gambling-video-game-violence-nfts-age-restrict/amp/ · https://sbcamericas.com/2025/11/05/youtube-update-policy-gambling-content/ · https://decrypt.co/347411/youtube-new-policy-doesnt-ban-all-crypto-content-despite-uproar

Source dates: Announced about 2025-10-28; effective 2025-11-17. Secondary sources only (support.google.com is blocked).

### [unverified] SEC Release 33-11412 (2026-03-17) classifies meme coins as non-security 'digital collectibles' (Researcher 4 marked this confirmed)

Downgraded from confirmed: sec.gov, govinfo.gov and federalregister.gov are all blocked, so the release text was never read. Search-index entries confirm that the document exists: Release Nos. 33-11412 / 34-105020, File No. S7-2026-09, 'Application of the Federal Securities Laws to Certain Types of Crypto Assets and Certain Transactions Involving Crypto Assets', joint with the CFTC, published at FR Doc. 2026-05635 in 91 FR No. 55 on 2026-03-23. Law-firm memos (DLA Piper, Sidley, Gibson Dunn, Ropes & Gray, Morgan Lewis, Lowenstein, EY) consistently report the following. There are five categories: digital commodities, digital collectibles, digital tools, stablecoins and digital securities. Meme coins are digital collectibles and not securities in themselves, but can be sold as part of an investment contract. Fractionalized collectibles may be securities. The release took effect on FR publication and supersedes prior SEC staff statements on the topics it covers. That last point matters: it likely makes the 2025-02-27 meme-coin staff statement, which Researchers 3 and 4 treat as the governing guidance, a superseded document.

Sources: https://www.sec.gov/files/rules/interp/2026/33-11412.pdf · https://www.govinfo.gov/content/pkg/FR-2026-03-23/html/2026-05635.htm · https://www.sec.gov/rules-regulations/2026/03/s7-2026-09 · https://www.sidley.com/en/insights/newsupdates/2026/03/sec-releases-landmark-interpretation-on-application-of-us-securities-laws-to-crypto-assets

Source dates: Issued 2026-03-17; FR 2026-03-23. Seen only as search-index entries and law-firm summaries.

### [conflicting_sources] ElevenLabs Starter plan price ($6/month vs $5/month)

elevenlabs.io is blocked, so only search-index text was available. That text from the official pricing pages says: Starter costs $6/month (first month $1 promo), includes 30,000 credits/month, and carries a commercial license. Free is 10,000 credits with no commercial license. Older ElevenLabs structured data and third-party guides say $5/month. A plausible reconciliation, based on Researcher 6's snippet that annual = monthly x 10: $6 is the monthly-billing price and about $5/month is the annual-billing equivalent ($60/year). The current price is not confirmed from the live page.

Sources: https://elevenlabs.io/pricing · https://elevenlabs.io/pricing/api

Source dates: Search-index entries around 2026-11-23, with a Black Friday promo active. Not loaded directly.

### [confirmed] ElevenLabs /with-timestamps endpoint returns character-level (not word-level) alignment; eleven_v4 is the recommended narration model

In the official SDK source (elevenlabs-python main; PyPI 2.79.0 uploaded 2026-11-16T13:54:38), the raw client calls v1/text-to-speech/{voice_id}/with-timestamps and v1/text-to-speech/{voice_id}/stream/with-timestamps. AudioWithTimestampsResponse has audio_base64 ("Base64 encoded audio data"), alignment: Optional[CharacterAlignmentResponseModel] = None, and normalized_alignment: Optional[...] = None. CharacterAlignmentResponseModel = {characters: List[str], character_start_times_seconds: List[float], character_end_times_seconds: List[float]}. The README lists 1. Eleven v4 (eleven_v4), 2. Eleven v4 Turbo (~100 ms), 3. Eleven Multilingual v2, 4. Eleven Flash v2.5 (~100 ms, "50% lower price per character"). Its examples use model_id="eleven_v4". Whether eleven_v4 returns non-null alignment was not tested.

Sources: https://raw.githubusercontent.com/elevenlabs/elevenlabs-python/main/src/elevenlabs/text_to_speech/raw_client.py · https://raw.githubusercontent.com/elevenlabs/elevenlabs-python/main/src/elevenlabs/types/audio_with_timestamps_response.py · https://raw.githubusercontent.com/elevenlabs/elevenlabs-python/main/src/elevenlabs/types/character_alignment_response_model.py · https://raw.githubusercontent.com/elevenlabs/elevenlabs-python/main/README.md · https://pypi.org/pypi/elevenlabs/json

Source dates: SDK 2.79.0 (2026-11-16); GitHub main read 2026-11-23.

### [confirmed] Piper commercial-safe English voices (en_US-joe/mike-medium, public-domain ljspeech/kristin/john/norman, hifi_tts_92 chain is CC BY 4.0) and the late-2026 retrain caveat

OHF-Voice/piper1-gpl docs/COMMERCIAL_USE.md (main) lists the voices whose "entire training chain" permits commercial use. rdh-based voices (CC0): en_US-joe-medium, en_US-mike-medium. Voices on the hifi_tts_92 base inherit its CC BY 4.0 attribution: en_US-hifi_tts_92-medium, en_GB-alba-medium, en_GB-cori-medium, en_US-kathleen-medium (own dataset CC0, but en_US-kathleen-low still descends from ryan), and en_GB-jenny_dioco-medium (custom license: must be called "Jenny"). Public domain: en_GB-cori-high, en_US-john-medium, en_US-kristin-medium, en_US-ljspeech-high/-medium, en_US-norman-medium. en_US-libritts-high is CC BY 4.0. Excluded: en_US-amy-medium (no documented license) and en_US-hfc_female-medium (CC BY-NC-SA). Quote: "Many voices below were retrained in late 2026 to remove a lessac base ... A copy downloaded before the retrain ... does not qualify". The MODEL_CARD Training section must name rdh or hifi_tts_92. The page also says: "This is not legal advice" and "The Piper project grants no license over voice models."

Sources: https://raw.githubusercontent.com/OHF-Voice/piper1-gpl/main/docs/COMMERCIAL_USE.md

Source dates: piper1-gpl main, read 2026-11-23.

### [unverified] YouTube Audio Library music: monetizable, attribution rules, and whether it can be used off YouTube

Still unverified. The official page (support.google.com/youtube/answer/3376882) appears in the search index only as a fragment that points to the 'License type' column and a Creative Commons filter, with no terms for use outside YouTube. Third-party guides contradict each other on whether standard-license tracks can be used off YouTube. Until the terms shown in YouTube Studio are read, treat standard-license tracks as YouTube-only. CC BY 4.0 tracks are governed by the CC BY 4.0 legal code, which Researcher 7 verified on GitHub.

Sources: https://support.google.com/youtube/answer/3376882?hl=en&rd=1

Source dates: Search-index fragment only, 2026-11-23.


## Remotion (remotion.dev): license, version and Node requirement, agent skills, custom Chrome, transitions, captions, audio-reactive animation, fonts, stills and multi-format rendering, calculateMetadata. Checked 2026-11-23 against the official remotion-dev GitHub repos (docs source at main commit 0e4c50cc, 2026-11-23) and the npm registry. www.remotion.dev was blocked by this session's network proxy, so the site itself was not read.

### [confirmed] (1a) Remotion is free for individuals and for for-profit companies with up to 3 employees

LICENSE.md currently says you can use Remotion free, commercial use included, if you are: "an individual"; "a for-profit organization with up to 3 employees"; "a non-profit or not-for-profit organization"; or "evaluating whether Remotion is a good fit, and are not yet using it in a commercial way". Free and Company licenses have the same features. The free license allows automations and SaaS use without paying per render. No account or registration is needed. Nuance: the License FAQ and the upcoming v5.0 Terms use broader wording: "an organization or team of individuals with up to 3 people". The v5.0 Terms (#TeamSize) say a Company License is required when "the combined total headcount of all involved parties ... is 4 or more". Headcount means "all personnel, regardless of whether they use the Remotion Software". Headcounts of parties that jointly own, control or use the codebase are added together, including part-time staff and independent contractors. A client that only receives the finished MP4 does not count. Draft PR #3750 (the 5.0 license) states "Contractors also count towards team size." Since LICENSE.md says that "In Remotion 5.0, the license will slightly change", the threshold stays at 3, but from v5 it counts people (contractors included), not just employees.

Sources: https://raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/license/faq.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/terms.mdx · https://github.com/remotion-dev/remotion/pull/3750

Source dates: LICENSE.md on main (Copyright © 2026), fetched 2026-11-23. Docs repo main commit 0e4c50cc dated 2026-11-23. terms.mdx is titled 'Terms and Conditions of Remotion (v5.0)', an upcoming document that takes effect with the 5.0 release. The current v4 terms (terms-4-0.mdx) say 'Latest update: November 23, 2023' (snapshot retrieved 2026-11-09). PR #3750 is a draft, opened 2024-04-22, with activity on 2026-11-18.

### [confirmed] (1b) Who needs a Company License, and what it costs

Anyone not eligible for the Free License needs a Company License. Options from the FAQ and v5 Terms: 'Remotion for Creators' costs $25 per Seat per month with no minimum, for people making videos by hand, with AI agents or in Studio, without an automation. AI agents themselves need no Seat. 'Remotion for Automators' costs $0.01 per render with a $100/month minimum. An automation is owning code that programmatically calls renderMedia(), renderStill(), renderFrames(), the Lambda/Cloud Run/Vercel/Web render APIs, `npx remotion render`, `npx remotion still`, the Lambda/Cloud Run CLI renders, or uses <Player>. One render is one successful video, audio, GIF, still or image sequence. Using both options together carries a $100/month minimum. Enterprise has a $500/month minimum. Licenses are bought in the Remotion Dashboard. The Automator rules do not apply to Free License users. All users are barred from a rendering service that lets end users upload their own Remotion code without written approval, and from reselling a derivative of Remotion. Telemetry: before 5.0, setting a licenseKey is voluntary. In 5.0 it becomes mandatory for Automators, and free users pass "free-license" (via --license-key / licenseKey / Config.setPublicLicenseKey).

Sources: https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/license/faq.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/terms.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/telemetry.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/5-0-migration.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/options/license-key.mdx

Source dates: Docs main commit 0e4c50cc (2026-11-23). The pricing page itself (/docs/license/pricing) renders a React <Pricing> component whose figures are not in the mdx. Prices were taken from the FAQ and Terms text.

### [confirmed] (2a) Current stable version of Remotion

The current stable release is Remotion 4.0.546: npm dist-tag 'latest' = 4.0.546, published 2026-11-23T09:33:13Z. All packages (remotion, @remotion/cli, @remotion/renderer, @remotion/transitions, @remotion/captions, @remotion/media-utils, @remotion/fonts, @remotion/google-fonts, @remotion/media, create-video) are at 4.0.546. Other npm dist-tags: alpha = 4.1.0-alpha12, canary = 4.0.0-alpha.217. Remotion 5.0 is NOT released: the 5-0-migration page says 'Remotion 5.0 is not yet released', and in source ENABLE_V5_BREAKING_CHANGES = false. Patch releases come about every 2–5 days (4.0.532 on 2026-10-01 through 4.0.546 on 2026-11-23). Mediabunny pairing: @remotion/media 4.0.546 depends on mediabunny 1.66.0. License fields: @remotion/captions, @remotion/media-utils, @remotion/fonts and @remotion/google-fonts are MIT. remotion, @remotion/cli, @remotion/renderer, @remotion/transitions and @remotion/media say 'SEE LICENSE IN LICENSE.md'.

Sources: https://registry.npmjs.org/remotion · https://registry.npmjs.org/@remotion%2Ftransitions/latest · https://registry.npmjs.org/@remotion%2Fmedia/latest · https://github.com/remotion-dev/remotion/blob/main/packages/core/src/v5-flag.ts · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/5-0-migration.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/mediabunny/version.mdx

Source dates: npm registry queried 2026-11-23. 4.0.546 was published 2026-11-23T09:33:13Z.

### [confirmed] (2b) Node.js requirement

Remotion 4.x minimums: Node 16, Bun 1.0.3. In source (packages/core/src/no-react.ts): MIN_NODE_VERSION = ENABLE_V5_BREAKING_CHANGES ? 22 : 16 and MIN_BUN_VERSION = ... ? '1.1.3' : '1.0.3'. Remotion 5.0 will need Node 22 and Bun 1.1.3. Other system requirements from getting-started: macOS 15 (Sequoia) or later; Linux glibc 2.35 or later (Ubuntu 22.04+; Amazon Linux 2023 x64 unsupported; Alpine and NixOS unsupported); plus the apt libraries on the Linux dependencies page (Ubuntu 24.04: libnss3 libdbus-1-3 libatk1.0-0 libasound2t64 libxrandr2 libxkbcommon-dev libxfixes3 libxcomposite1 libxdamage1 libgbm-dev libcups2 libcairo2 libpango-1.0-0 libatk-bridge2.0-0). npm's 'engines' field is not set on the Remotion packages. Separately, the `skills` CLI used for agent skills declares engines node >=22.20.0.

Sources: https://github.com/remotion-dev/remotion/blob/main/packages/core/src/no-react.ts · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/getting-started.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/src/components/AvailableFrom.tsx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/miscellaneous/linux-dependencies.mdx · https://registry.npmjs.org/skills/1.7.0

Source dates: Docs main commit 0e4c50cc (2026-11-23).

### [confirmed] (3) `npx skills add remotion-dev/skills` is the official way to install Remotion's agent skills

Official, but it is the documented fallback for when Remotion is not installed in the project. The docs give four commands:
- `npx remotion skills add` is preferred inside a Remotion project (since v4.0.411; `npx remotion skills update` updates). It runs `npx --loglevel=error skills@1.7.0 add remotion-dev/skills --yes`.
- `npx skills add remotion-dev/skills` (vercel-labs `skills` CLI, latest 1.9.0, MIT, needs Node >=22.20.0) when Remotion is not installed.
- `gh skill install remotion-dev/skills`.
- `npx create-video@latest --skills` (v4.0.541+), which runs `npx -y --loglevel=error skills@1.7.0 add remotion-dev/skills --agent universal --skill '*' --yes`.
Where files go: the Remotion docs say skills go to `.agents/skills`, with `.claude/skills` symlinked to `.agents/skills` for Claude Code. With the plain skills CLI, project scope is the default and each agent has its own folder: claude-code uses `.claude/skills/` (global `~/.claude/skills/`); universal, Codex and Cursor use `.agents/skills/`. Symlinks are the default and `--copy` copies instead. `-g` installs globally, `-a <agent>` picks the agent, `-s '*'` picks all skills. A `skills-lock.json` records content hashes.
The github.com/remotion-dev/skills repo (mirror of packages/skills, version 4.0.546, last commit 89c8afa 2026-11-23) holds 13 skills: remotion-best-practices (router), remotion-create, remotion-markup, remotion-studio, remotion-render, remotion-maps, remotion-captions, remotion-saas, remotion-interactivity, remotion-docs, remotion-license (v4.0.540+), remotion-upgrade, remotion-multimedia. The docs on main also list /remotion-elements, which is not yet in the skills repo.

Sources: https://github.com/remotion-dev/skills · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/ai/skills.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/cli/skills.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/cli/create-video.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/cli/src/skills.ts · https://github.com/vercel-labs/skills/blob/main/README.md · https://github.com/vercel-labs/skills/blob/main/docs/agents.md · https://github.com/vercel-labs/skills/blob/main/docs/commands.md · https://registry.npmjs.org/skills

Source dates: remotion-dev/skills HEAD 89c8afa (2026-11-23 10:56 +0100). Remotion docs main 0e4c50cc (2026-11-23). skills@1.9.0 published 2026-11-16. skills@1.7.0 (pinned by Remotion) published 2026-09-17.

### [confirmed] (4) Custom Chrome binary: Config.setBrowserExecutable / --browser-executable; chrome-headless-shell support

Config file: `import {Config} from '@remotion/cli/config'; Config.setBrowserExecutable('/path/to/chrome');` in remotion.config.ts (since v1.5.0). Type: `setBrowserExecutable(newBrowserExecutablePath: BrowserExecutable)`, where `type BrowserExecutable = string | null`. It applies only to the CLI and Studio.
CLI flag: `--browser-executable <path>`, which overrides the config. It is accepted by remotion studio, render, still, compositions, browser ensure, benchmark, gpu, and lambda/cloudrun render/still.
Node API option: `browserExecutable` on renderMedia(), renderStill(), renderFrames(), selectComposition(), getCompositions(), openBrowser(), ensureBrowser().
Chrome Headless Shell is not just supported, it is the default since v4.0.247. Remotion downloads it on the first render (not during npm install) to `node_modules/.remotion/chrome-headless-shell/[version]/[platform]/chrome-headless-shell-[platform]`. Download hosts: remotion.media (Remotion's builds) and storage.googleapis.com (Chrome for Testing and some other cases). Pre-fetch with `npx remotion browser ensure` or ensureBrowser(). Pinned Chrome versions: 158.0.8127.2 from 4.0.540; 157.0.8080.0 from 4.0.534.
`Config.setChromeMode()` / `--chrome-mode` take `'headless-shell'` (default) or `'chrome-for-testing'`; the latter is only for GPU-accelerated rendering on Linux.
The docs warn that a full Chrome binary 'may differ between Chrome versions and may be less deterministic'. Do not apt-install chromium. Shared-memory frame capture (v4.0.534+) works only with Remotion's own Headless Shell builds.

Sources: https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/config.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/options/browser-executable.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/miscellaneous/chrome-headless-shell.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/options/chrome-mode.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/cli/browser/ensure.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/cli/src/config/index.ts · https://github.com/remotion-dev/remotion/blob/main/packages/renderer/src/browser-executable.ts

Source dates: Docs main 0e4c50cc (2026-11-23). The version table lists 4.0.540 → Chrome 158.0.8127.2.

### [confirmed] (5a) @remotion/transitions: TransitionSeries, fade/slide/wipe presentations, timing

Install with `npx remotion add @remotion/transitions`. Imports: `import {TransitionSeries, linearTiming, springTiming} from '@remotion/transitions'`, plus `fade` from '@remotion/transitions/fade', `slide` from '@remotion/transitions/slide', `wipe` from '@remotion/transitions/wipe'.
Components (TransitionSeries since v4.0.53): <TransitionSeries> holds <TransitionSeries.Sequence durationInFrames offset? premountFor? ...>, <TransitionSeries.Transition timing presentation? motionBlur?> and <TransitionSeries.Overlay durationInFrames offset?> (v4.0.415). If presentation is omitted, it defaults to slide(). TransitionSeries also takes durationInFrames? (v4.0.533).
Timings:
- `linearTiming({durationInFrames, easing?})`
- `springTiming({config?, durationInFrames?, durationRestThreshold? (default 0.005), reverse?})`
- `timing.getDurationInFrames({fps})`: e.g. springTiming({config:{damping:200}}) gives 23 at 30fps.
Presentations:
- `fade({enterStyle?, exitStyle?, shouldFadeOutExitingScene? (default false)})`
- `slide({direction?: 'from-left'|'from-right'|'from-top'|'from-bottom' (default 'from-left'), enterStyle?, exitStyle?})`
- `wipe({direction?: 'from-left'|'from-top-left'|'from-top'|'from-top-right'|'from-right'|'from-bottom-right'|'from-bottom'|'from-bottom-left', outerEnterStyle?, outerExitStyle?, innerEnterStyle?, innerExitStyle?})`
Many more presentations exist (clock-wipe, iris, flip, cube, dissolve, zoom-blur, ...).
Timing math: a Transition overlaps two scenes and shortens the total (e.g. 40 + 60 − 30 = 70 frames). An Overlay does not shorten anything. layout="none" is deprecated and throws from 5.0.

Sources: https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/transitions/transitionseries.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/transitions/presentations/fade.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/transitions/presentations/slide.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/transitions/presentations/wipe.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/transitions/timings/lineartiming.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/transitions/timings/springtiming.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/transitions/timings/index.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/cli/add.mdx

Source dates: Docs main 0e4c50cc (2026-11-23). Package version 4.0.546.

### [confirmed] (5b) @remotion/captions: Caption type, createTikTokStyleCaptions

@remotion/captions is MIT-licensed and available since v4.0.216.
The Caption type: `type Caption = {text: string; startMs: number; endMs: number; timestampMs: number | null; confidence: number | null; pageBreakAfter?: boolean /* v4.0.517 */}`. text is whitespace-sensitive: put a leading space before each word and render with CSS `white-space: pre`.
Signature: `createTikTokStyleCaptions({captions: Caption[], combineTokensWithinMilliseconds: number, breakOnSilenceAfterMilliseconds?: number /* v4.0.514 */}): {pages: TikTokPage[]}`.
TikTokPage = {text, startMs, durationMs, tokens: TikTokToken[]}. TikTokToken = {text, fromMs, toMs, pageBreakAfter?}.
Other exports: parseSrt, parseVtt, serializeSrt, plus the types CreateTikTokStyleCaptionsInput/Output.

Sources: https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/captions/caption.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/captions/create-tiktok-style-captions.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/captions/src/caption.ts · https://github.com/remotion-dev/remotion/blob/main/packages/captions/src/create-tiktok-style-captions.ts · https://github.com/remotion-dev/remotion/blob/main/packages/captions/src/index.ts

Source dates: Repo main 0e4c50cc (2026-11-23).

### [confirmed] (5c) @remotion/media-utils: useAudioData / useWindowedAudioData / visualizeAudio

Package: @remotion/media-utils (MIT).
- `useAudioData(src: string, options?: {sampleRate?: number /* default 48000 */, requestInit?: RequestInit}): MediaUtilsAudioData | null`. Loads the whole file and handles delayRender internally.
- `useWindowedAudioData({src, frame, fps, windowInSeconds, channelIndex? = 0, requestInit?}): {audioData: MediaUtilsAudioData | null, dataOffsetInSeconds: number}`. Available since v4.0.240. It loads only the current window plus the windows before and after via HTTP Range requests. Before v4.0.383 it supported WAV only; it now handles all Mediabunny formats. windowInSeconds cannot change after the first render. Recommended for long audio.
- `visualizeAudio({audioData, frame, fps, numberOfSamples /* power of 2 */, smoothing? = true, optimizeFor?: 'accuracy'|'speed', dataOffsetInSeconds? /* v4.0.268 */}): number[]`. Returns values from 0 to 1. optimizeFor defaults to 'accuracy' in v4 and changes to 'speed' in v5.
Also exported: visualizeAudioWaveform, createSmoothSvgPath, getWaveformPortion, getAudioData. getAudioDurationInSeconds is deprecated in favour of Mediabunny.
For playback, the current docs use `<Audio>` from @remotion/media (`import {Audio} from '@remotion/media'`).

Sources: https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/use-audio-data.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/use-windowed-audio-data.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/visualize-audio.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/media-utils/src/index.ts · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/video-and-audio.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/5-0-migration.mdx

Source dates: Docs main 0e4c50cc (2026-11-23).

### [confirmed] (5d) Fonts: @remotion/google-fonts vs local fonts via staticFile + @remotion/fonts loadFont

Google fonts: `import {loadFont} from '@remotion/google-fonts/<FontName>'` (e.g. '/Inter', '/Lobster'). Call `loadFont(style?, {weights?: string[], subsets?: string[], document?, ignoreTooManyRequestsWarning?})`. It returns {fontFamily, fonts, unicodeRanges, waitUntilDone} and blocks the render until the font is loaded. The font files are fetched from fonts.gstatic.com at render time. In v4, calling it with no args loads every variant; from v5 non-empty `weights` and `subsets` are required, or it throws.
Local fonts (v4.0.164+): `import {loadFont} from '@remotion/fonts'` and call `loadFont({family, url: staticFile('x.woff2'), format?: 'woff2'|'woff'|'opentype'|'truetype', weight?, style?, display?, stretch?, unicodeRange?, featureSettings?, ascentOverride?, descentOverride?, lineGapOverride?}): Promise<void>`. It blocks the render, and a failed load fails the render. For font URLs that come from props, call it in useEffect with useDelayRender().
A manual FontFace + delayRender approach is also documented. Both font packages are MIT.

Sources: https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/fonts.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/google-fonts/load-font.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/fonts-api/load-font.mdx

Source dates: Docs main 0e4c50cc (2026-11-23).

### [confirmed] (6) Rendering stills (npx remotion still <comp> --frame) and multiple compositions/aspect ratios

Stills:
- Command: `npx remotion still <entry-point|serve-url>? [<composition-id>] [<output-location>]`.
- --frame=<n>: default 0; negative values allowed, with -1 as the last frame.
- --image-format: png (default), jpeg, pdf or webp.
- Other flags: --props, --scale (0 < scale ≤ 16), --output, --browser-executable, --chrome-mode, --width/--height overrides, --license-key and --is-production (v4.0.539).
- Without a composition id the command prompts for one. In non-interactive or CI runs `render` fails and lists the IDs.
- <Still id component width height> is a single-frame composition that needs no durationInFrames or fps.
- Several stills at once: `npx remotion render MyComp out/frames --frames=0,30,90 --image-format=png` (v4.0.502).
Multiple compositions:
- No built-in 'render all' flag. The docs show a bash loop over `npx remotion compositions src/index.ts -q`, or a Node script with `bundle({entryPoint})`, `getCompositions({serveUrl, inputProps: {}})` and `renderMedia({codec:'h264', composition, serveUrl, outputLocation})`.
- For aspect ratios, register one <Composition> per format with its own width/height, or return width/height from calculateMetadata. --width/--height (v3.2.40) and Config.overrideWidth/overrideHeight override a composition's size.

Sources: https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/cli/still.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/options/frame.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/options/still-image-format.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/stills.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/still.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/render-all.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/cli/render.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/options/width.mdx

Source dates: Docs main 0e4c50cc (2026-11-23).

### [confirmed] (7) calculateMetadata for audio-driven durations

calculateMetadata (v4.0.0) is a <Composition> prop typed `CalculateMetadataFunction<Props>` (from 'remotion').
Arguments: {defaultProps, props, abortSignal, compositionId (v4.0.98), isRendering (v4.0.342)}.
It returns a JSON-serializable object, possibly async, that can contain: props?, durationInFrames?, width?, height?, fps?, defaultCodec?, defaultOutName? (v4.0.268), defaultVideoImageFormat?, defaultPixelFormat? (v4.0.316), defaultProResProfile? (v4.0.367), defaultSampleRate? (v4.0.448).
It runs once per render, in a separate tab, during selectComposition(). It must resolve within the delayRender timeout (default 30000 ms).
Recommended audio-duration pattern (docs and remotion-multimedia skill): `const input = new Input({formats: ALL_FORMATS, source: new UrlSource(src)}); const sec = await input.computeDuration(); return {durationInFrames: Math.ceil(sec * fps)};` using mediabunny (`npx remotion add mediabunny`, version 1.66.0 for Remotion 4.0.544+). In Node/Bun, use FilePathSource. `getMediaMetadata()` is a user-written helper in the docs, not a Remotion export. `getAudioDurationInSeconds()` from @remotion/media-utils is deprecated.
In v5, props are validated against the composition's zod `schema` before calculateMetadata runs, and invalid props fail the render.

Sources: https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/calculate-metadata.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/videos/align-duration.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/mediabunny/metadata.mdx · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/get-audio-duration-in-seconds.mdx · https://github.com/remotion-dev/skills/blob/main/skills/remotion-multimedia/get-audio-duration.md · https://github.com/remotion-dev/remotion/blob/main/packages/docs/docs/mediabunny/version.mdx

Source dates: Docs main 0e4c50cc (2026-11-23). Skills repo 89c8afa (2026-11-23).

**Pipeline implications**

- Licensing: run under the Free License only while total headcount stays ≤3. Count all owners, employees and contractors of the entity running the Remotion repo, plus any partner who co-owns or uses the code; clients who only receive MP4s do not count. Record this in the repo's CLAUDE.md. No registration is needed. Re-check eligibility before adding a 4th collaborator.
- Pin `remotion` and every `@remotion/*` package to the same exact version with no caret; 4.0.546 is the latest stable as of 2026-11-23 (the existing project uses 4.0.541). Add packages with `npx remotion add <pkg>`, upgrade with `npx remotion upgrade`, and check with `npx remotion versions`. If mediabunny is used directly, pin it to the version Remotion pairs with (1.66.0).
- Standardize on Node 22 LTS ≥22.20.0. This meets Remotion 4 (min 16), the upcoming Remotion 5 (min 22) and the skills CLI (>=22.20.0). Render hosts must be Linux with glibc ≥2.35 (Ubuntu 22.04/24.04) and have the documented apt libraries installed.
- Agent skills: inside the project run `npx remotion skills add` (or `npx skills add remotion-dev/skills -a claude-code`) and update with `npx remotion skills update`. Commit `skills-lock.json` and the `.claude/skills` (or `.agents/skills`) directory.
- Browser: prefer Remotion's pinned Chrome Headless Shell. Pre-fetch it at build time with `npx remotion browser ensure`, which needs remotion.media and storage.googleapis.com reachable. Where those hosts are blocked, set `Config.setBrowserExecutable(path)` in remotion.config.ts or pass `--browser-executable <path>` (the flag wins). Point it at a chrome-headless-shell of the same Chrome major (158.x for Remotion ≥4.0.540), keep chromeMode 'headless-shell', and never use an apt-installed chromium.
- Transitions: build scenes with <TransitionSeries> and use linearTiming({durationInFrames}) for predictable timing. Compute total frames as sum(scene durations) − sum(transition durations); overlays do not subtract. Set explicit durationInFrames on springTiming. Never use layout='none'. Use fade({shouldFadeOutExitingScene: true}) only between non-opaque scenes.
- Captions: convert TTS word timestamps to Caption[] ({text: ' word' with a leading space, startMs, endMs, timestampMs, confidence}). Run createTikTokStyleCaptions({captions, combineTokensWithinMilliseconds, breakOnSilenceAfterMilliseconds?}) to get pages and render them with white-space: pre. Export an .srt with serializeSrt for YouTube upload.
- Audio-reactive art: for long narration, use useWindowedAudioData({src: staticFile(...), frame, fps, windowInSeconds}) with a constant windowInSeconds. Pass dataOffsetInSeconds into visualizeAudio({..., numberOfSamples: power of 2}). Always set optimizeFor explicitly so v5's default change cannot shift visuals. Play audio with <Audio> from @remotion/media.
- Fonts: for deterministic, offline-capable renders, bundle .woff2 files in public/ and load them with `loadFont({family, url: staticFile('Font.woff2'), weight})` from @remotion/fonts. If @remotion/google-fonts is used, always pass style plus non-empty weights and subsets (required in v5), and allow fonts.gstatic.com at render time.
- Thumbnails: define <Still> compositions and render with `npx remotion still src/index.ts <StillId> out/thumb.png --frame=<n> --image-format=png` (or --frame=-1 for the last frame). For several frames, use `npx remotion render <Comp> out/frames --frames=0,30,90 --image-format=png`.
- Multi-format output: register one composition ID per format (for example 1920x1080 landscape and 1080x1920 vertical), or return width/height from calculateMetadata based on props. Layouts must read useVideoConfig() and must not hard-code sizes. In CI, always pass the composition ID, because non-interactive runs without it fail. Batch with `npx remotion compositions src/index.ts -q` in a loop, or a Node script using bundle({entryPoint}), selectComposition/getCompositions({serveUrl, inputProps: {}}) and renderMedia().
- Audio-driven duration: in calculateMetadata, return {durationInFrames: Math.ceil(seconds * fps) + tailPaddingFrames}. Get the seconds from mediabunny `new Input({formats: ALL_FORMATS, source: new UrlSource(staticFile(file))}).computeDuration()`, or better, from the TTS step passed in as a prop. Keep returned props JSON-serializable, resolve within 30 s, and do not use the deprecated getAudioDurationInSeconds.
- Prepare for v5 now: use object-form bundle({entryPoint})/getCompositions({serveUrl}) and always pass inputProps. Give compositions zod schemas and make props valid, since invalid props will fail renders. Be ready to pass `--license-key=free-license` / Config.setPublicLicenseKey('free-license') when upgrading to 5.0.

**Open risks**

- www.remotion.dev and remotion.pro were blocked by this session's network proxy (CONNECT 403), so the live site was not read. Every docs fact comes from the official docs source in github.com/remotion-dev/remotion/packages/docs/docs at main commit 0e4c50cc (2026-11-23). The live site can lag or lead main slightly: for example, main's ai/skills.mdx lists /remotion-elements, which the published remotion-dev/skills repo does not yet contain.
- The License & Pricing page renders prices from a React component (@remotion/promo-pages Pricing) not in the repo. The $25/seat, $0.01/render, $100 and $500 minimums come from the FAQ and the v5 Terms text, not from that rendered calculator.
- License wording conflict across versions: LICENSE.md (v4) says 'for-profit organization with up to 3 employees'. The FAQ and upcoming v5 Terms say 'organization or team of individuals with up to 3 people' and add up headcount across all involved parties, contractors included (PR #3750, still a draft). If the creator's ventures (bot, AI-agent hosting platform, memecoin community) are run by one entity or collaborators sharing the Remotion codebase with 4 or more total people, contractors and co-owning partners included, a Company License is needed. The free tier then stops applying, and automated `npx remotion render` pipelines fall under 'Remotion for Automators' ($0.01/render, $100/month minimum).
- The Terms bar any service that lets end users bring or upload their own Remotion code without Remotion's written approval. Embedding Remotion rendering into the AI-agent hosting platform as a user-facing feature would need review or a license, and probably a Company License if that entity has more than 3 people.
- Remotion 5.0 is unreleased but announced, with breaking changes: Node 22 minimum; licenseKey 'free-license' expected; @remotion/google-fonts needing weights and subsets; TransitionSeries layout='none' throwing; inputProps required in selectComposition/getCompositions; invalid props failing renders; visualizeAudio defaulting to optimizeFor 'speed'. An unpinned upgrade could break the pipeline.
- Using a non-Remotion Chrome binary via setBrowserExecutable (for example Playwright's chrome-headless-shell 158.0.8127.36 at /opt/pw-browsers, compared with Remotion's pinned 158.0.8127.2-remotion build) is allowed but officially 'may be less deterministic'. It also skips Remotion's patched build and its shared-memory capture.
- @remotion/google-fonts and remote assets need network access at render time (fonts.gstatic.com), and the default browser download needs remotion.media and storage.googleapis.com. Offline or sandboxed render hosts will fail unless these are pre-provisioned.

## YouTube Partner Program and channel monetization policy, plus upload specs (Shorts, end screens, chapters, thumbnails, loudness). Checked 2026-11-23. VERIFICATION METHOD CAVEAT: this session's network policy blocked support.google.com, blog.youtube, youtube.com and developers.google.com (proxy 403 / ENOTFOUND), so I could not load any primary page directly. All facts below come from WebSearch index extracts of the official support.google.com and blog.youtube URLs listed. Several independent queries returned matching quotes, but per the task rules these are marked unverified (or conflicting_sources) until someone reads the live pages.

### [unverified] (1a) Current YPP thresholds for ad revenue sharing (ads and Premium revenue)

Per support.google.com/youtube/answer/72851 (index extracts), through Jan 31, 2027: either 1,000 subscribers + 4,000 valid public watch hours on long-form videos in the last 12 months, or 1,000 subscribers + 10 million valid public Shorts views in the last 90 days. Older pages say 'qualified' and newer ones say 'valid public'. Watch hours from Shorts in the Shorts feed, private, unlisted or deleted videos, ad campaigns and some livestreams do not count toward the 4,000. You also need to follow the channel monetization policies, live in an available country/region, have no active Community Guidelines strikes, turn on 2-Step Verification on the Google Account, and link one active AdSense for YouTube account. Every application goes through a human review, so meeting the threshold does not guarantee acceptance.

Sources: https://support.google.com/youtube/answer/72851?hl=en · https://support.google.com/youtube/answer/13429240?hl=en

Source dates: Pages not loaded directly (support.google.com blocked in this session); extracts show the current 'valid public' wording.

### [unverified] (1b) YPP ad-revenue entry thresholds change on Feb 1, 2027 (NEW, announced Aug 10, 2026)

Per support.google.com/youtube/answer/12843009 ('Changes to the YouTube Partner Program') and the YouTube Blog post 'New opportunities to earn and changes to the YouTube Partner Program' (dated Aug 10, 2026), from Feb 1, 2027 new creators applying for ads and Premium revenue sharing need 1,000 subscribers plus either 8,000 qualified watch hours in the last 365 days or 20M qualified Shorts views in the last 90 days. Channels already in YPP keep their status, but they must review and accept the updated terms in YouTube Studio by Jan 31, 2027 or they stop earning from the related features on Feb 1, 2027. A new 'active channel' rule also starts Feb 1, 2027: at least 1,000 qualified watch hours in 365 days, or 1M qualified Shorts views in 90 days, or 2 long-form videos or 5 Shorts uploaded every 90 days. Channels that fall below get an extended 90-day window to recover. Premium Lite expands to every Premium country, and creators share a pool of 60% of net Premium Lite subscription revenue (30% for Premium). The 8,000 and 20M figures appear in both the official help page extract and the blog extract, and many third-party write-ups repeat them.

Sources: https://support.google.com/youtube/answer/12843009?hl=en · https://blog.youtube/news-and-events/youtube-partner-program-updates-2027-new-opportunities-earn/

Source dates: Blog post dated Aug 10, 2026; changes effective Feb 1, 2027; terms acceptance deadline Jan 31, 2027. Not loaded directly.

### [unverified] (1c) Expanded YPP lower tier (fan funding and Shopping): thresholds and countries

Per support.google.com/youtube/answer/13429240: either 500 subscribers + 3 valid public uploads in the last 90 days + 3,000 valid public watch hours in the last 12 months, or 500 subscribers + 3 valid public uploads in the last 90 days + 3M valid public Shorts views in the last 90 days. This tier unlocks fan funding (channel memberships, Super Chat, Super Stickers, Super Thanks) and YouTube Shopping. Ad and Premium revenue sharing still need the 1,000-subscriber tier. The same requirements apply: monetization policies, available country, 2-Step Verification, linked AdSense for YouTube. The Feb 2027 changes page and blog say the fan funding, Shopping and Creator Partnerships thresholds are NOT changing. Countries: the troubleshooter page (support.google.com/youtube/troubleshooter/13536952) says the expanded YPP 'has fully rolled out' in a long list running from Algeria to Vietnam, which includes the US, UK, Canada, Australia, India, Japan and Brazil. I could not obtain the full list. Pages disagree slightly, for example Belarus appears on the 13429240 list but not on the troubleshooter list.

Sources: https://support.google.com/youtube/answer/13429240?hl=en · https://support.google.com/youtube/troubleshooter/13536952?hl=en · https://support.google.com/youtube/answer/12843009?hl=en · https://support.google.com/youtube/answer/7101720?hl=en

Source dates: Not loaded directly; country lists differ between snapshots.

### [unverified] (2a) 'Repetitious content' renamed to 'inauthentic content': effective date and official wording

Per support.google.com/youtube/answer/1311392 (YouTube channel monetization policies), update dated July 15, 2025. Extracted wording: YouTube is 'making a minor update to our "repetitious content" policy to better clarify this includes content that is repetitive or mass-produced' and is 'renaming this policy from "repetitious content" to "inauthentic content."' It adds that 'This type of content has always been ineligible for monetization under our existing policies, where creators are rewarded for original and authentic content.' and that 'there is no change to our reused content policy.' General requirement in the policy: content should 'Not be mass-produced, generic, repetitive, or manipulative.' I found no official 2026 revision to this section. One third-party blog claims a July 16, 2026 split into three categories, which nothing else corroborates.

Sources: https://support.google.com/youtube/answer/1311392?hl=en · https://support.google.com/youtube/blog/356734251/response-to-creator-questions-about-ypp-policies-july-2025?hl=en-AS

Source dates: Policy update effective July 15, 2025. Not loaded directly.

### [unverified] (2b) What the inauthentic content policy counts as mass-produced or repetitive, including templated and AI examples

Not allowed to monetize, per extracts of answer/1311392: 'Similar or repetitive content with low educational value, commentary, narratives or minimal variation across videos'; 'Videos where characters are put in the same situation over and over again with the same outcome' (described as 'a highly similar storyline template across multiple videos'); 'Image slideshows, templated storylines or scrolling text with minimal or no narrative, commentary or educational value'; channels whose videos feel interchangeable or 'appear to be produced using a template' where each video does not deliver creative, educational or other value; 'AI-generated content made with generic or unoriginal templates giving the impression of mass production without adding the creator's original, authentic insights or perspective'; unrelated AI clips stitched together for shock value with no clear narrative arc. Also not monetizable: channels using AI-generated personas that present themselves 'as a human expert providing advice to viewers on topics such as health, legal issues, finances, or politics.' Allowed: the same intro and outro on every video if the bulk of the content differs; a series (recurring characters, or product reviews) where each video has a distinct storyline, focus or concept; an authentic spin on a popular format; using AI to visualize a unique character and narrative you invented, to edit scripts, or to generate background visuals. Creators using automated tools or templates must still show creative vision and educational or entertainment value. Related Spam policy (answer/2801973) example of a violation: channels reusing the exact same background music and repetitive AI-generated imagery across many videos, each reading out an AI-generated script. Penalties can be monetization suspension, channel termination, or removal plus a strike. Two extracts give the section heading as 'Inauthentic content' and one as 'Generic or repetitive content'; check the live page.

Sources: https://support.google.com/youtube/answer/1311392?hl=en · https://support.google.com/youtube/answer/2801973?hl=en

Source dates: July 15, 2025 version. Not loaded directly.

### [unverified] (3) Reused content policy

Per answer/1311392 and the YouTube Community FAQ: reused content 'refers to channels that repurpose content that's already on YouTube or another online source without adding significant original commentary, substantive modifications or educational or entertainment value.' 'We allow reused content if viewers can tell that there's a meaningful difference between the original video and your video.' The policy applies even if you have permission from the original creator, and it is separate from copyright, permission and fair use. Allowed examples: clips used in a critical review, film scenes with rewritten dialogue and a new voiceover, sports replays where the creator explains how a competitor succeeded, reaction videos that comment on the original, others' footage edited with an added storyline and commentary. Not allowed: clips from a show stitched together with little or no narrative, short videos compiled from other social media sites, collections of songs by different artists (even with permission), content copied without substantive modification, reactions that are mostly non-verbal, songs with only pitch or speed changed. The policy was not changed by the July 2025 inauthentic-content update.

Sources: https://support.google.com/youtube/answer/1311392?hl=en · https://support.google.com/youtube/community-guide/271248162/%F0%9F%94%8E-faq-reused-content-youtube%E2%80%99s-partner-program?hl=en

Source dates: Not loaded directly.

### [unverified] (4a) Shorts maximum length

Per support.google.com/youtube/answer/15424877 ('Understand three-minute YouTube Shorts'): videos uploaded on or after Oct 15, 2024 with a square or vertical aspect ratio and up to 3 minutes long are categorized as Shorts on standard channels. For Official Artist Channels the same rule applies to uploads after Dec 8, 2025. The Content ID treatment of Shorts between 1 and 3 minutes conflicts across versions of the page: older versions say any Short over 1 minute with an active copyright claim of any type 'will be blocked globally', while a newer extract says that 'Starting on 24 September 2026, new Shorts longer than one minute (but under three minutes) with an active Content ID claim will no longer be automatically blocked and may remain playable.'

Sources: https://support.google.com/youtube/answer/15424877?hl=en · https://support.google.com/youtube/answer/12779649?hl=en

Source dates: 3-minute rule from Oct 15, 2024; Content ID change dated Sep 24, 2026 (conflicts with older version). Not loaded directly.

### [unverified] (4b) How Shorts revenue sharing works

Per support.google.com/youtube/answer/12504220 (Shorts monetization policies) and answer/72902: ad revenue from ads shown between Shorts in the Shorts Feed is pooled monthly (the Creator Pool). Part of it goes to music licensing: for Shorts that use music, the revenue from their engaged views is split by track count (1 track: half goes to the pool; 2 tracks: one third goes to the pool). The Creator Pool is then allocated to monetizing YPP creators by their share of engaged Shorts views in each country. Creators keep 45% of the revenue allocated to them, whether or not they used music. Ineligible views include unedited clips of others' movies or TV, reuploads, compilations with no original content, and artificial views. NEW from Feb 1, 2027 (answer/12843009): a channel earns from the Shorts Creator Pool in a given month only if it had 10M qualified Shorts views in the previous 90 days. Missing that does not remove the channel from YPP or affect long-form earnings, and Shorts earnings resume automatically once the channel is back above 10M. YouTube says sub-threshold channels get other incentives, such as Shopping bonuses and trend-based boosts.

Sources: https://support.google.com/youtube/answer/12504220?hl=en · https://support.google.com/youtube/answer/72902?hl=en · https://support.google.com/youtube/answer/12843009?hl=en

Source dates: Not loaded directly; Creator Pool floor effective Feb 1, 2027.

### [unverified] (5) End screens: duration window and minimum video length

Per support.google.com/youtube/answer/6388789: 'End screens can be added to the last 5–20 seconds of a video. Your video has to be at least 25 seconds long to have an end screen.' Up to 4 elements on standard 16:9 videos; other aspect ratios may allow fewer. End screens are not available on videos set as made for kids, in the YouTube Music or YouTube Kids apps, on mobile web (except iPad), or on 360 videos. Viewers can hide them.

Sources: https://support.google.com/youtube/answer/6388789?hl=en

Source dates: Not loaded directly.

### [unverified] (6) Chapter requirements

Per support.google.com/youtube/answer/9884579 (Video Chapters): timestamps go in the video description; the first timestamp must start at 00:00; there must be at least 3 timestamps in ascending order; the minimum chapter length is 10 seconds. Chapters you enter manually override automatic chapters, and not every video is eligible for automatic chapters.

Sources: https://support.google.com/youtube/answer/9884579?hl=en

Source dates: Not loaded directly.

### [conflicting_sources] (7) Thumbnail specs and custom-thumbnail eligibility

Per support.google.com/youtube/answer/72431 (current version, as extracted): 'Have a resolution of 3840 x 2160 pixels (with minimum width of 640 pixels)'. 16:9 is implied. Upload size limits depend on device: 'Mobile: 2 MB for video thumbnails or 10 MB for podcasts. Desktop: 50MB for both video thumbnails and podcast thumbnails.' This replaces the old 1280x720 / 2 MB spec. CONFLICT on formats: one version of the page says 'JPG, GIF, or PNG' and another says 'JPG or PNG'. Google Ads video spec (a different product) still lists 1280x720 recommended, minimum 1280x640. Eligibility: custom thumbnails are an 'intermediate' feature that requires phone verification of the channel (Studio > Settings > Channel > Feature eligibility > Verify phone number; per answer/9890437 and answer/171664). Access can be lost if the channel has Community Guidelines or copyright strikes. One phone number can verify only a limited number of channels per year (an extract says 2). Third-party sites report Shorts thumbnails as 9:16 (2160x3840); this is not confirmed on an official page.

Sources: https://support.google.com/youtube/answer/72431?hl=en · https://support.google.com/youtube/answer/9890437?hl=en · https://support.google.com/youtube/answer/171664?hl=en · https://support.google.com/youtube/answer/9722880?hl=en · https://support.google.com/google-ads/answer/13547298?hl=en

Source dates: 4K / 50 MB spec appears to date from late 2025; not loaded directly.

### [unverified] (8) YouTube loudness normalization target

No official YouTube help page or developer doc giving a loudness normalization target was found. The widely reported value is about -14 LUFS integrated: YouTube turns down louder content and does not turn up quieter content. This comes from community and tutorial sources only, not YouTube. The official help pages describe only the viewer-side 'Stable volume' feature (answer/14106294), which is on by default and evens out quiet and loud parts, but is off for YouTube Music and official music videos and turns off when Voice boost is on. They also describe the creator-side 'Let YouTube enhance audio quality' checkbox under Advanced settings (answer/16619284). For a different Google product, the Google Assistant audio guidance recommends -16 LUFS for stereo.

Sources: https://support.google.com/youtube/answer/14106294?hl=en · https://support.google.com/youtube/answer/16619284?hl=en · https://developers.google.com/assistant/tools/audio-loudness

Source dates: No official target exists to date; not loaded directly.

**Pipeline implications**

- Plan monetization around the 2027 rules: a channel applying for ads revenue on or after Feb 1, 2027 needs 1,000 subscribers + 8,000 public long-form watch hours in 365 days, or 20M Shorts views in 90 days. Treat the expanded tier (500 subs + 3 uploads in 90 days + 3,000 hours in 12 months or 3M Shorts views in 90 days, which unlocks memberships, Super Thanks and Shopping, and is unchanged in 2027) as the realistic first milestone. Treat the videos as promotion for the creator's own products, not an ad-revenue play.
- Once in YPP, keep the channel 'active' under the 2027 rule: upload at least 2 long-form videos or 5 Shorts every 90 days, or hold 1,000 watch hours in 365 days, or 1M Shorts views in 90 days. Accept the updated YPP terms in Studio before Jan 31, 2027 if already a partner.
- Inauthentic-content guardrails for the Remotion templates: every video needs a distinct topic, script and narrative arc, and must not be a re-skin of one template. Vary scene layouts, SVG art, background music and pacing between videos. Reusing the same intro, outro and brand elements is fine. Never ship image slideshows, scrolling text or kinetic-typography-only videos with thin narration. Do not reuse one music bed plus repetitive generated imagery plus an AI-read script across many uploads (a named Spam-policy pattern). Put a human-authored, product-specific perspective in each script, and do not batch-flood uploads.
- AI persona and financial-topic risk: the TTS narrator or animated host must NOT present as a human expert giving financial advice. Channels with AI personas giving advice on finances are barred from monetization. For the Solana scanner bot and memecoin videos, frame content as product demos and tutorials for the creator's own software, add 'not financial advice', avoid price predictions and buy/sell calls, and do not make the TTS voice sound like a real, credentialed person.
- Reused content: use only original footage (screen recordings of the creator's own bot and platform, original SVG animation). Do not use third-party video clips, social-media compilations or unmodified stock clips. Permission does not exempt a channel from this rule.
- Shorts render profile: 1080x1920 (9:16) or square, duration at most 180 s. Use only owned or licensed royalty-free audio, because Content ID handling of claimed 1-3 minute Shorts is in flux (sources conflict). If any third-party audio is unavoidable, keep the Short at 60 s or less to be safe.
- End screens: every long-form video must be at least 25 s long. Reserve a dedicated end card of 5-20 s at the end of each render (recommend the full 20 s), with clear space for up to 4 elements on a 16:9 canvas. Do not mark videos made-for-kids, since that disables end screens.
- Chapters: auto-generate the description timestamp block from the Remotion scene timeline. Start at 00:00, include at least 3 timestamps in ascending order, and make every chapter at least 10 s long (merge shorter scenes).
- Thumbnails: render with Remotion renderStill at 3840x2160 (16:9), or at least 1280x720, never under 640 px wide. Export as JPG or PNG; skip GIF because the formats conflict across page versions. Keep files under 2 MB so mobile uploads also work (the desktop limit is 50 MB). Phone-verify the channel before the first upload, because custom thumbnails need intermediate features.
- Audio mastering in ffmpeg: normalize the final mix with loudnorm=I=-14:TP=-1.5:LRA=11. Use two-pass loudnorm for accuracy and AAC-LC at 48 kHz stereo. -14 LUFS is the community-measured YouTube reference, not an official spec; -16 LUFS is a safe alternative that YouTube will not turn up or down.

**Open risks**

- NETWORK BLOCK: this session's egress policy denied support.google.com, blog.youtube, youtube.com and developers.google.com (WebFetch ENOTFOUND, curl CONNECT 403). No primary page was read directly, and every fact comes from search-engine index extracts of those official URLs. To mark these confirmed, allow support.google.com and blog.youtube under Network access > Allowed domains in the cloud environment settings and re-run this check.
- The Feb 1, 2027 YPP changes (8,000 hours / 20M Shorts views for new applicants, the 10M-views-in-90-days floor for the Shorts Creator Pool, and the activity rule) were announced Aug 10, 2026. Details could still be revised before they take effect.
- The Content ID treatment of Shorts between 1 and 3 minutes conflicts between page versions: blocked globally (older) versus no longer automatically blocked from Sep 24, 2026 (newer).
- Thumbnail formats conflict between page versions (JPG/GIF/PNG versus JPG/PNG). The 3840x2160 / 50 MB spec is recent, and some third-party sources still cite 1280x720 / 2 MB.
- The exact current section heading and full example list for inauthentic content were not read verbatim; extracts differ ('Inauthentic content' versus 'Generic or repetitive content'). A third-party claim of a July 2026 restructuring is uncorroborated.
- YouTube publishes no official loudness target; -14 LUFS is community-derived.
- Not in scope here, but material for this channel: advertiser-friendly guidelines and YouTube's Spam, deceptive practices and scams policy as they apply to crypto and memecoin promotion; Google Ads cryptocurrency policy (affects ad suitability); paid-promotion and self-promotion disclosure rules; and the altered/synthetic content disclosure for realistic AI voices. These need separate verification before publishing memecoin content.
- The full country list for expanded YPP was not obtained; only that it includes the US, UK, Canada, Australia, India, Japan, Brazil and many others (troubleshooter 13536952).

## Disclosure and audience rules for a creator's YouTube videos (YouTube AI/synthetic-content label, YouTube paid-promotion/branded-content declaration, FTC Endorsement Guides 2023 and Disclosures 101, COPPA and "made for kids"), checked as of 2026-11-23

### [confirmed] YouTube requires creators to disclose realistic content that AI generated or meaningfully altered.

The help article is now titled 'Disclosing use of GenAI content' (support.google.com/youtube/answer/14328491). It was formerly 'Disclosing use of altered or synthetic content'. In YouTube Studio the disclosure is the 'AI use' question in the Attributes section: 'select Yes if your content meets the disclosure requirements or No if not.' Disclosure is required when content is generated or meaningfully altered with AI and looks realistic (some regional versions say 'photorealistic', others 'seems realistic'). The examples are: (a) making a real person appear to say or do something they didn't, such as appearing to be arrested or imprisoned; (b) altering footage of a real event or place; (c) generating a realistic-looking scene that never happened. The page says the list is 'not exhaustive'. The requirement was announced on the YouTube Blog on 2024-03-18. Creators who consistently fail to disclose may have a label applied manually or face penalties, including content removal or suspension from the YouTube Partner Program. YouTube says disclosure itself does not limit reach or monetization eligibility.

Sources: https://support.google.com/youtube/answer/14328491?hl=en · https://support.google.com/youtube/answer/14328491?hl=en&co=GENIE.Platform%3DDesktop · https://support.google.com/youtube/answer/14328491?hl=en-GB · https://blog.youtube/news-and-events/disclosing-ai-generated-content/

Source dates: Help article is current (renamed 'GenAI content' after the 2026 label update). Original blog post dated 2024-03-18 (date corroborated by TechCrunch and 9to5Google URLs of 2024-03-18).

### [confirmed] Explicit exemptions: clearly unrealistic or animated content, beauty filters, and production assistance do not need the label.

Not required: (1) non-realistic content such as animation or fantastical scenes (the 2024 blog's example was 'someone riding a unicorn through a fantastical world'); (2) 'minor' edits that are 'primarily aesthetic, and don't alter the content in a way that could mislead the viewer', including colour or lighting filters, special effects such as background blur or vintage effects, and beauty filters or other visual enhancements; (3) production assistance, meaning generative AI used to create or improve a video outline, script, thumbnail, title, or infographic; (4) caption creation and idea generation ('productivity' uses); (5) 'Cloning one's own voice to create voice overs or dubs', listed under minor edits in current versions of the help page.

Sources: https://support.google.com/youtube/answer/14328491?hl=en&co=GENIE.Platform%3DDesktop · https://support.google.com/youtube/answer/14328491?hl=en-GB · https://blog.youtube/news-and-events/disclosing-ai-generated-content/

Source dates: Help page current as of 2026. The own-voice-clone exemption appears in the current Desktop and en-GB versions; wording varies by region.

### [corrected] AI text-to-speech narration of a fictional cartoon host requires the AI label.

No label is required. The trigger is realistic content, in particular making a real, identifiable person appear to say or do something. A fictional animated host is 'non-realistic content (animation)', and a generic TTS voice does not belong to a real identifiable person, so it falls outside the requirement. YouTube's text has no explicit example for TTS of a fictional character, so this conclusion applies the stated rule rather than quoting it. The label becomes required if: the voice is a synthetic clone or imitation of a real third party (the 2024 blog lists 'synthetically generating a person's voice to narrate a video' as requiring disclosure); or the video includes photorealistic AI imagery or video, AI-altered real footage, or realistic AI scenes of real events. Since the May 2026 update, a voluntary 'Yes' on non-realistic or animated content shows the disclosure only in the expanded description.

Sources: https://support.google.com/youtube/answer/14328491?hl=en · https://blog.youtube/news-and-events/disclosing-ai-generated-content/ · https://blog.youtube/news-and-events/improving-ai-labels-viewers-creators/

Source dates: Blog 2024-03-18; label update blog May 2026 (press coverage dated 2026-05-27).

### [confirmed] Rules on voice cloning and on depicting real people.

(1) The label is required when AI makes a real person appear to say or do something they didn't, or when a person's voice is synthetically generated to narrate. Cloning your own voice for voiceovers or dubs is exempt. (2) Privacy Guidelines ('Protecting your identity', answer 2801895): the person depicted, or their legal representative, can request removal of AI-altered or synthetic content that looks or sounds like them through the Privacy Complaint Process. The person must be uniquely identifiable. YouTube weighs whether the content is disclosed as synthetic, whether it is realistic, and whether it is parody or satire, and may apply a higher bar for public officials and well-known people. Removal is not guaranteed. (3) Likeness detection (answer 16440338) currently matches only enrolled creators' faces; voice misuse goes through the privacy complaint process. (4) Impersonation policy (answer 2801947): using AI to copy someone's voice or likeness so that a channel looks authorized violates the policy.

Sources: https://support.google.com/youtube/answer/14328491?hl=en · https://support.google.com/youtube/answer/2801895?hl=en · https://support.google.com/youtube/answer/16440338?hl=en · https://support.google.com/youtube/answer/2801947?hl=en · https://blog.youtube/inside-youtube/our-approach-to-responsible-ai-innovation/

Source dates: Help pages current in 2026. 'Responsible AI innovation' blog dated Nov 2023.

### [confirmed] How and where YouTube shows the AI label, and automatic labeling.

Update announced in May 2026 ('Improving AI labels for viewers and creators'; coverage dated 2026-05-27). Photorealistic or meaningfully AI-altered content gets a single prominent label: below the player, above the description, on long-form videos, and as an overlay on Shorts. For 'content that is unrealistic, animated, or slightly altered', the disclosure appears only in the expanded description. From May 2026, if a creator does not specify AI use but YouTube's systems detect 'significant photorealistic AI use', YouTube applies a label automatically. A creator can change the disclosure status in Studio, but the label cannot be removed if the video was made with YouTube's own AI tools (Veo, Dream Screen), carries verified C2PA metadata showing it is fully AI-generated, or was labeled after manual review by Trust and Safety. Before this update, the 2024 policy put most labels in the expanded description and a more prominent player label on sensitive topics: health, news, elections and finance.

Sources: https://blog.youtube/news-and-events/improving-ai-labels-viewers-creators/ · https://blog.google/intl/en-in/products/platforms/improving-ai-labels-for-viewers-and-creators/ · https://support.google.com/youtube/blog/424874071/updates-to-ai-content-disclosure-and-labels?hl=en · https://blog.youtube/news-and-events/disclosing-ai-generated-content/

Source dates: May 2026 (TechCrunch and 9to5Google coverage dated 2026-05-27); original policy 2024-03-18.

### [confirmed] YouTube's 'paid promotion' checkbox and when it is required.

Studio checkbox wording: 'My video contains paid promotion like a product placement, sponsorship, or endorsement'. YouTube now uses the term 'branded content'; some help text says 'My video contains a branded content'. Help definitions (answer 154235): paid product placement is content 'created for a third party in exchange for compensation' with that third party's brand integrated into the content. A sponsorship is a video 'financed in whole or in part by a company' that promotes the brand without integrating it into the content. An endorsement is a video 'created for an advertiser or marketer' carrying a message that reflects the creator's opinions. The new 'YouTube Branded Content Policies' page (answer 17596007), as quoted by multiple outlets, defines branded content as content 'influenced by a brand partner in exchange for something of value' (payment, free products, sponsorship, 'whether you receive the benefit now or later on'). It applies to videos, descriptions, comments, live streams and Shorts. When the box is checked, YouTube shows viewers a disclosure message; the old 'Includes paid promotion' tag is being replaced by a new branded-content label. A TeamYouTube post (~2026-09-03) also announced age and geographic controls that appear only after paid promotion is set to Yes, plus automated detection that labels undeclared branded content, 'rolling out ... in the coming months'. Creators can certify that a wrongly labeled video has no branded content. Declaring branded content does not by itself remove monetization eligibility; one source says it removes the video from YouTube Kids.

Sources: https://support.google.com/youtube/answer/154235?hl=en-GB · https://support.google.com/youtube/answer/17596007?hl=en · https://support.google.com/youtube/answer/10588440?hl=en · https://support.google.com/youtube/thread/458476782?hl=en

Source dates: Policy rename and automated-detection announcement about 2026-09-03 (TechTimes 2026-09-04). One secondary blog cites a 2026-10-03 policy date that no other source corroborates.

### [unverified] The paid-promotion checkbox is required when promoting your own product.

No official YouTube text addressing a creator's own product or company was found. Every official definition is framed around a third party, brand partner, advertiser or company paying or giving value, which suggests promoting your own product with no third-party value is outside the checkbox. Secondary guides agree but are not authoritative. The checkbox is clearly required whenever any third party gives value: cash, free product, sponsorship, affiliate or referral commission, or a token allocation from another party. Whatever YouTube requires, the FTC requires in-video disclosure of ownership unless it is obvious (see FTC claims). YouTube's automated detection could flag own-product promotion; false positives can be certified as containing no branded content.

Sources: https://support.google.com/youtube/answer/154235?hl=en-GB · https://support.google.com/youtube/answer/17596007?hl=en

Source dates: Help pages 2026; Branded Content Policies page about Sept 2026.

### [confirmed] FTC Endorsement Guides, 16 CFR Part 255, 2023 revision: dates and core standard.

The FTC announced the revised Guides on 2023-06-29. They were published at 88 FR 48092-48112 (FR Doc. 2023-14795) on 2023-07-26, effective that day. §255.5: a material connection between endorser and seller must be disclosed 'clearly and conspicuously'. 'A material connection needs to be disclosed when a significant minority of the audience for an endorsement does not understand or expect the connection' (the 2023 text changed 'significant proportion' to 'significant minority'). Material connections include business, family or personal relationships; monetary payment; free or discounted products, even unrelated ones and whether or not an endorsement is required in return; early access; and the possibility of being paid or winning a prize. §255.0(f) defines 'clearly and conspicuously' as 'difficult to miss (i.e., easily noticeable) and easily understandable by ordinary consumers'. The disclosure must use the same means as the claim: visual claims need at least a visual disclosure, audible claims at least an audible one, and claims made both ways need both. 'A disclosure presented simultaneously in both the visual and audible portions of a communication is more likely to be clear and conspicuous.' A visual disclosure must stand out by 'size, contrast, location, the length of time it appears'. An audible disclosure must be delivered at a 'volume, speed, and cadence sufficient for ordinary consumers to easily hear and understand it'. The Guides are not themselves binding law: they interpret FTC Act §5, and violations are pursued as deception.

Sources: https://www.federalregister.gov/documents/2023/07/26/2023-14795/guides-concerning-the-use-of-endorsements-and-testimonials-in-advertising · https://www.govinfo.gov/content/pkg/FR-2023-07-26/html/2023-14795.htm · https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-255 · https://www.ftc.gov/news-events/news/press-releases/2023/06/federal-trade-commission-announces-updated-advertising-guides-combat-deceptive-reviews-endorsements

Source dates: Approved 2023-06-29; FR published and effective 2023-07-26.

### [confirmed] Ownership of the promoted product must be disclosed.

The FTC FAQ ('FTC's Endorsement Guides: What People Are Asking') says that when an influencer promotes their own brand, no disclosure is needed if it is obvious from the endorsement that the brand is the influencer's own; otherwise the ownership must be disclosed. The FAQ also says 'the ultimate responsibility for clearly and conspicuously disclosing a material connection rests with the influencer and the brand – not the platform'. Precedent: the FTC's CSGO Lotto case, the first against individual influencers (complaint and press release 2017-09-07; final order approved Nov 2017). YouTubers Trevor 'TmarTn' Martin and Thomas 'Syndicate' Cassell, each a 42.5% owner of CSGOLotto, Inc., promoted the site without disclosing ownership. A 'sponsored' note placed only in the description box, 'below the fold', was alleged inadequate. They had also paid other influencers $2,500 to $55,000 in cash or skins without disclosure.

Sources: https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking · https://www.ftc.gov/news-events/news/press-releases/2017/09/csgo-lotto-owners-settle-ftcs-first-ever-complaint-against-individual-social-media-influencers · https://www.ftc.gov/system/files/documents/cases/1623184_csgolotto_complaint.pdf · https://www.ftc.gov/news-events/news/press-releases/2017/11/ftc-approves-final-consent-order-against-owners-csgo-lotto-website

Source dates: FAQ updated with the 2023 Guides (index copy about 2025). CSGO Lotto 2017-09-07 and 2017-11.

### [confirmed] Affiliate links must be disclosed, and how.

The FTC FAQ says affiliate marketers must disclose the relationship clearly and conspicuously and, when making videos, 'disclose the affiliate relationship both in the videos and in the description near the links'. It adds that 'the closer the disclosure is to your recommendation, the better' and that disclosures mixed in with links or hashtags are easy to miss. In the Guides' affiliate example (a coffee-maker blogger paid a share of sales), the reviews 'should clearly and conspicuously disclose the compensation'. No wording is mandated; the FTC's examples include 'This is an ad for BRAND'.

Sources: https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking · https://www.ftc.gov/system/files/ftc_gov/pdf/P204500%20Guides%20Concerning%20Endors%20and%20Testimonials.pdf

Source dates: FAQ 2023 revision; Guides 2023-07-26.

### [confirmed] Disclosures in a video must be both spoken and on-screen, not only in the description (Disclosures 101).

'Disclosures 101 for Social Media Influencers' (FTC, November 2019) defines a material connection as including 'a personal, family, or employment relationship or a financial relationship' and says 'Financial relationships aren't limited to money.' For video, 'the disclosure should be in the video and not just in the description uploaded with the video.' 'Viewers are more likely to notice disclosures made in both audio and video. Some viewers may watch without sound and others may not notice superimposed words.' Disclosures are likely to be missed if they appear only on an ABOUT ME or profile page, 'at the end of posts or videos', or behind a MORE click. In live streams the disclosure 'should be repeated periodically'. The FTC FAQ adds that a platform's built-in tool is not automatically sufficient; the FTC would judge whether the tool alone clearly and conspicuously discloses the connection, so creators should add their own disclosure. The 2023 Guides make audio-plus-visual the expected form when the claim is made both ways.

Sources: https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers · https://www.ftc.gov/system/files/documents/plain-language/1001a-influencer-guide-508_1.pdf · https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking

Source dates: Disclosures 101 published November 2019 and not revised after the 2023 Guides; FAQ revised 2023.

### [confirmed] FTC Consumer Reviews and Testimonials Rule (16 CFR Part 465) also limits self-promotion.

Published 2024-08-22 (FR Doc. 2024-18519), effective 2024-10-21. Because it is a trade regulation rule, courts can impose civil penalties for knowing violations, unlike the Guides. It prohibits: reviews or testimonials by officers or managers that do not clearly and conspicuously disclose their material connection; procuring reviews from officers, managers, employees, agents or their immediate relatives for third-party platforms when the business knew or should have known they were misleading; reviews conditioned on a particular sentiment; and selling or buying fake indicators of social media influence such as followers or views. The operative text of the fake-indicator section was not retrieved.

Sources: https://www.federalregister.gov/documents/2024/08/22/2024-18519/trade-regulation-rule-on-the-use-of-consumer-reviews-and-testimonials · https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers · https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials

Source dates: FR 2024-08-22; effective 2024-10-21.

### [confirmed] Every creator must set the YouTube 'made for kids' audience.

Every creator must set an audience at the channel or video level, 'regardless of your location', including creators who don't make kids' content. YouTube says this is required by COPPA and the September 2019 settlement with the FTC and New York Attorney General ($170 million total). The creator carries the legal responsibility: YouTube's systems may not identify content the FTC considers made for kids. 'Failure to set your content appropriately may result in consequences on YouTube or have legal consequences under COPPA and other laws.'

Sources: https://support.google.com/youtube/answer/9527654?hl=en&co=GENIE.Platform%3DDesktop · https://support.google.com/youtube/answer/9528076?hl=en · https://support.google.com/youtube/answer/9684541?hl=en · https://blog.youtube/news-and-events/better-protecting-kids-privacy-on-youtube/

Source dates: Help pages current in 2026. Requirement introduced Nov 2019 to Jan 2020; the exact 2020-01-06 date was not confirmed.

### [confirmed] Factors that make content child-directed, including animated characters.

YouTube's factors (answer 9528076): subject matter; whether children are the intended or actual audience; child actors or models; 'characters, celebrities, or toys that appeal to children, including animated characters or cartoon figures'; language intended for children to understand; activities such as 'play-acting, simple songs or games, or early education'; songs, stories or poems for children; and other information such as empirical audience evidence. The COPPA Rule (16 CFR 312.2) lists subject matter, visual content, 'use of animated characters or child-oriented activities and incentives', music or other audio, age of models, child celebrities, language, child-directed advertising, and evidence of intended and actual audience. A service is child-directed even if children are a secondary audience. The FTC's YouTube guidance (blog, Nov 2019) says bright colors or animated characters do not automatically make content child-directed, that no single factor decides, and that videos about adult topics such as 'employment, finances, politics, home ownership' are probably not covered unless geared toward kids.

Sources: https://support.google.com/youtube/answer/9528076?hl=en · https://www.ftc.gov/business-guidance/blog/2019/11/youtube-channel-owners-your-content-directed-children · https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-312 · https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions

Source dates: FTC blog Nov 2019; YouTube help current; eCFR current.

### [conflicting_sources] The 2025 COPPA Rule amendments: dates and new child-directed factors.

Dates confirmed: final amended rule published 2025-04-22 (FR Doc. 2025-05904), effective 2025-06-23, general compliance date 2026-04-22. The FTC said regulated entities are not required to 'continuously monitor the Internet' for third-party reviews. New factors reported only by secondary (law-firm) sources: 'marketing or promotional materials or plans, representations to consumers or to third parties, reviews by users or third parties, and the age of users on similar websites or services'. A secondary reproduction of §312.2 lacks them, probably the pre-2025 text. The Federal Register page citation is also inconsistent across sources: 90 FR 16918 in several, 16970 or 16904 in others.

Sources: https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule · https://www.govinfo.gov/content/pkg/FR-2025-04-22/html/2025-05904.htm

Source dates: FR 2025-04-22; effective 2025-06-23; compliance 2026-04-22.

### [corrected] The current inflation-adjusted FTC civil penalty per COPPA violation.

$53,088 per violation. This is the 15 U.S.C. 45(m)(1)(A) cap codified at 16 CFR 1.98(d), which applies to COPPA Rule violations. It was set by FR Doc. 2025-01361, published and effective 2025-01-17 (up from $51,744; multiplier 1.02598). For 2026 the FTC made no adjustment: its notice published 2026-09-15 (FR Doc. 2026-18853, 91 FR 58446) keeps the 2025 levels, because OMB memo M-26-11 cancelled the 2026 adjustment after the government shutdown prevented BLS from producing October 2025 CPI-U data. Older figures, such as $42,530 in the FTC's 2019 YouTube blog and $50,120, are outdated. Enforcement precedent on YouTube labeling: Disney paid a $10 million civil penalty for mislabeling YouTube videos as not made for kids (announced 2025-09-02, court-approved Dec 2025) and must run an audience-designation program for 10 years.

Sources: https://www.federalregister.gov/documents/2025/01/17/2025-01361/adjustments-to-civil-penalty-amounts · https://www.federalregister.gov/documents/2026/09/15/2026-18853/civil-penalty-inflation-adjustments · https://www.govinfo.gov/content/pkg/FR-2026-09-15/html/2026-18853.htm · https://www.ftc.gov/news-events/news/press-releases/2025/09/disney-pay-10-million-settle-ftc-allegations-company-enabled-unlawful-collection-childrens-personal · https://www.ftc.gov/news-events/news/press-releases/2025/12/court-approves-order-requiring-disney-pay-10-million-settle-ftc-allegations-firm-enabled-unlawful

Source dates: 2025-01-17 (2025 adjustment); 2026-09-15 (no 2026 adjustment); Disney 2025-09-02 and Dec 2025.

### [confirmed] Which features are disabled on made-for-kids videos (comments, end screens, cards, notifications).

On a video or live stream set as made for kids, YouTube turns off: autoplay on home; cards or end screens; the video or channel branding watermark; channel memberships; comments; the donate button; merchandise and ticketing; notifications (the notification bell); personalized advertising (only non-personalized ads, in certain categories); playback in the Miniplayer; Super Chat and Super Stickers; and Save to playlist and Save to Watch Later. If the whole channel is set as made for kids, every upload loses these, and the channel also loses channel memberships, the notification bell, posts, and Ask Studio. So comments, cards, end screens and notifications are all disabled.

Sources: https://support.google.com/youtube/answer/9527654?hl=en&co=GENIE.Platform%3DDesktop · https://support.google.com/youtube/answer/9632097?hl=en · https://support.google.com/youtube/answer/9609276?hl=en

Source dates: Help pages current (the Ask Studio item shows a 2025-2026 revision).

### [confirmed] YouTube Partner Program 'inauthentic content' policy, relevant to an automated pipeline.

On 2025-07-15 YouTube renamed the 'repetitious content' monetization policy to 'inauthentic content' and clarified that it covers 'repetitive or mass-produced' content, which is ineligible for monetization. The reused content policy did not change. AI-assisted channels remain eligible if they meet monetization policies. Rejections and suspensions can be appealed in Studio within 21 days.

Sources: https://support.google.com/youtube/answer/1311392?hl=en · https://support.google.com/youtube/blog/356734251/response-to-creator-questions-about-ypp-policies-july-2025?hl=en-AS

Source dates: 2025-07-15.

**Pipeline implications**

- Add a per-video provenance manifest, for example disclosure.json, generated by the render pipeline. It records ai_use_required (bool), paid_promotion (bool), material_connections[] (own_product, token_holdings, affiliate, sponsor) and audience ('not_made_for_kids'). Upload metadata and on-screen disclosure overlays are driven from this file, not set by hand.
- YouTube 'AI use' attribute: default to No when every visual is code-drawn SVG or Remotion animation and narration is a generic TTS voice for a fictional host. Force Yes automatically if any asset is photorealistic AI imagery or video, AI-altered real footage or screenshots, a realistic AI scene of a real event or place, or a synthetic voice resembling any real identifiable person other than the creator. Never use clones or imitations of third-party voices or likenesses (crypto founders, influencers, celebrities). Cloning the creator's own voice is exempt.
- Do not use YouTube's own generative tools (Veo, Dream Screen) or imported assets carrying C2PA 'fully AI-generated' metadata unless you accept a label that cannot be removed. After each upload, check Studio for an automatic AI label or branded-content label and correct false positives.
- For every video promoting the creator's own bot, platform or memecoin, render a spoken plus on-screen ownership disclosure in the first scene, before or at the first product mention, for example: 'I built [Product]. This is my own project.' For the memecoin add: 'I hold [TOKEN] and may benefit if it rises.' Repeat it at every call to action. The FTC exemption for 'obvious' ownership is narrow, so do not rely on it.
- Overlay spec, following the FTC factors of size, contrast, location and duration: a high-contrast text card at least ~4-5% of frame height, inside the safe area, on screen long enough to read (rule of thumb ≥ 3-5 s, or for the full sentence plus margin). It must not be in the end screen region and must not sit only in the final seconds. The TTS line must be at normal volume and speed, never sped up or ducked under music.
- Description template: put the disclosure in the first 1-2 lines, above the 'Show more' fold, and directly next to any affiliate or referral link (exchange, DEX, bot rev-share). This supplements the in-video disclosure and does not replace it.
- Check YouTube's paid-promotion/branded-content box whenever any third party gives value: sponsorship, free product, affiliate or referral commission, partner rev-share, or a token allocation or grant from another party. For pure own-product promotion, YouTube's definitions don't clearly require it. Checking it is a low-cost conservative choice, but it never replaces the FTC in-video disclosure, because the FTC says platform tools alone may be insufficient.
- Live streams: repeat the spoken and on-screen disclosure periodically, for example on a fixed timer overlay and a verbal reminder every ~10-15 minutes, as an implementation choice. The FTC requires that it be 'repeated periodically'.
- Audience setting: set the channel default and every upload to 'No, it's not made for kids' via the API field status.selfDeclaredMadeForKids=false. Design to keep the cartoon host clearly adult and finance-oriented: no toy-like or chibi child characters, nursery-style music, simple songs or games, child-level language, or kid-targeted thumbnails or titles. Keep subject matter on trading, finance and software. Archive audience analytics (age breakdown) as evidence. Animated characters are an explicit COPPA factor, though not decisive alone.
- Record $53,088 per violation (16 CFR 1.98(d); unchanged for 2026 per FR 2026-09-15) as the current COPPA penalty figure in docs. Re-check in January 2027 for the next inflation adjustment.
- Never buy views, subscribers or likes, and never post undisclosed reviews or testimonials by the team or relatives (16 CFR Part 465, effective 2024-10-21, which allows civil penalties for knowing violations). Any team-member testimonial on screen must disclose the relationship.
- Avoid 'inauthentic' mass-produced output: vary scripts, scenes and structure per video, and add original commentary or value so automated templating does not lose YPP monetization (policy renamed 2025-07-15).
- No links or redirects to gambling-style sites involving crypto tokens or NFTs (YouTube gambling policy change reported effective 2025-11-17). No promises of returns or price predictions in scripts. Add a standard 'not financial advice; I own this project/token' line to memecoin videos.

**Open risks**

- Verification limitation: this session's network policy blocked direct fetches (WebFetch and curl) of support.google.com, ftc.gov, ecfr.gov, federalregister.gov, govinfo.gov and blog.youtube, which returned proxy 403 / ENOTFOUND. Every primary source was read only through the search tool's extracts and quotations of those official pages, cross-checked across several queries, never by loading the full page. Before publishing compliance docs, a human should open the cited official URLs in a browser and confirm the exact wording. support.google.com, www.ftc.gov, www.ecfr.gov and www.federalregister.gov must be allowed in the session network settings for direct verification.
- The YouTube help article 14328491 wording differs by region and platform version ('photorealistic' vs 'seems realistic'; own-voice-clone exemption listed in some versions). The AI-music example and any TTS-specific example could not be confirmed on the official page.
- Branded-content policy timing conflicts: the announcement is dated about 2026-09-03 (TeamYouTube post; TechTimes 2026-09-04), while one secondary blog cites a 2026-10-03 policy date. Automated branded-content detection was described as 'rolling out in the coming months'; its current status and appeal path are unclear, and false positives on own-product promotion are possible.
- No official YouTube statement was found on whether promoting a creator's own product or token requires the paid-promotion/branded-content declaration. The 'own product' conclusion rests on the third-party framing of the definitions.
- The full text of 16 CFR 255.0(f) was not retrieved. In particular, the 'interactive electronic medium ... must be unavoidable' element and the exact 255.5 list wording ('possibility of winning a prize, of being paid, or of appearing on television') were not verified verbatim.
- The 2025 COPPA amendment additions to the 'directed to children' factors (marketing materials, representations, third-party reviews, ages of users on similar services) are confirmed only by secondary sources. The FR page citation for Doc. 2025-05904 is inconsistent across sources.
- Memecoin and securities law were not verified in this pass. The SEC Division of Corporation Finance staff statement of 2025-02-27 says typical meme coins are not securities but is 'not dispositive' and excludes disguised offerings. If any project token is a security, Securities Act §17(b) anti-touting rules (disclosing consideration received and its amount) would apply. An SEC 2026 interpretive release (33-11412) on crypto assets exists but was not read. CFTC, state and non-US rules (UK ASA/CMA/FCA financial promotions, EU MiCA marketing rules) are not covered.
- FTC staff guidance (Disclosures 101, Nov 2019; FAQ) is not binding and Disclosures 101 predates the 2023 Guides. Enforcement relies on FTC Act §5 deception. Civil penalties for endorsement failures generally require a trade regulation rule (e.g., Part 465) or a prior notice of penalty offenses.
- Some TTS voices are derived from real voice actors. If a provider's voice is recognizable as a specific real person, the 'real person's voice' trigger and privacy complaints could apply, so check the TTS license and voice provenance.
- The YouTube made-for-kids feature list is from current help pages, but the exact item list varies between page versions ('video watermarks' vs 'channel branding watermark'; 'notifications' vs 'notification bell'). Whether YouTube can override a creator's audience setting, and the exact mechanics, were not verified.

## Legal and platform risks of promoting crypto-related products (Solana token-observation Telegram bot, AI-agent hosting platform with noncustodial payments, Pump.fun community memecoin) on YouTube. US law plus YouTube and Google policy, verified as of 2026-11-23.

### [corrected] YouTube 'Spam, deceptive practices & scams' policy (support.google.com/youtube/answer/2801973): which rules apply to crypto promotion

The page is now titled 'Spam Policy' and has been reorganized. The older version had headings such as 'Scams: content offering cash gifts, get rich quick schemes, or pyramid schemes'. The current text says it covers 'content, metadata or behaviour designed to take advantage of the YouTube community', including unlisted and private videos, comments, links, posts, thumbnails and coordinated channel networks. Its categories include: (a) Scams: "Promoting 'get rich quick' investment schemes or fake job offers or sharing fake customer support contact information to steal private data like bank details, passwords or government IDs". (b) Engagement manipulation: "...offering rewards in exchange for likes, views or subscribers. It's okay to ask viewers to like, comment or subscribe." (c) Off-platform diversion: "Content created solely to drive users off YouTube to external sites...". (d) Malicious clickbait: "maliciously misleading titles, thumbnails, descriptions, or imagery to trick users into clicking on a video that does not deliver what was promised". (e) Automated or synthetic mass production: "Using automated tools or AI to churn out high volumes of similar content with minimal changes". The policy's own example is "Channels that use the exact same background music and repetitive AI-generated imagery across many videos, with each video reading out an AI-generated script." (f) Scraped content. (g) Detection evasion. (h) Comment spam. Sanctions include content removal, warnings and strikes, loss of monetization, and channel termination. The Transparency Report renamed this enforcement category 'Spam, deceptive practices and scams' in September 2025. From a September 2026 update, impersonation enforcement is also counted under it. For April–June 2026 YouTube reports removing 2,310,181 channels in this category.

Sources: https://support.google.com/youtube/answer/2801973?hl=en · https://support.google.com/transparencyreport/answer/9198203?hl=en · https://transparencyreport.google.com/youtube-policy?hl=en

Source dates: Direct fetch of support.google.com was blocked in this session (proxy 403). The text was verified from search-engine extraction of the official page on 2026-11-23. Two versions of the page are indexed with different headings. Third-party sites date the reorganization to 2026, which is unverified.

### [confirmed] YouTube crypto-specific Community Guidelines rules, and the 'financial' parts of the Harmful or dangerous content policy

The only crypto-specific rule found in the Community Guidelines is in the Harmful or dangerous content policy (answer/2801964), under Digital security: "Cryptophishing: Requests for cryptocurrency or cryptocurrency-related wallet details as a part of a phishing scheme". The same section also covers phishing for nonpublic personal information and hacking to steal credentials. Exceptions are possible for educational, documentary, scientific or artistic (EDSA) content. Return and investment promises ('get rich quick') are handled under the Spam Policy, not Harmful or dangerous. No Community Guidelines rule that specifically names crypto giveaways was found. Giveaways are governed by the contest policy and the engagement-manipulation rule instead.

Sources: https://support.google.com/youtube/answer/2801964?hl=en · https://support.google.com/youtube/answer/2801973?hl=en

Source dates: Search extraction of official pages on 2026-11-23 (direct fetch blocked)

### [confirmed] YouTube Impersonation policy

answer/2801947 prohibits impersonating a person, entity or channel in a way that could mislead viewers, including 'deceptively copying the branding, content, or usernames'. Examples given: copying a profile picture, banner or color scheme (the copy does not have to be 100% identical), adding 'Real', 'Official', 'Backup', 'Shorts' or 'Live' to another's name, names that are phonetically identical or visually similar, and typos, special fonts or punctuation tricks. Fan channels must say so in the channel name or handle. From September 2026 the Transparency Report counts impersonation channel enforcement under the spam category.

Sources: https://support.google.com/youtube/answer/2801947?hl=en · https://support.google.com/transparencyreport/answer/9198203?hl=en

Source dates: Search extraction 2026-11-23

### [confirmed] YouTube enforcement ladder (warnings and strikes)

A first violation is usually a warning. Optional policy training lets the warning expire after 90 days, but repeating the same policy violation inside that window can produce a strike. Strike 1 brings a 1-week posting freeze and stays on the channel for 90 days. Strike 2 within 90 days brings a 2-week freeze. Three strikes within 90 days 'may' lead to termination (the tips page says the channel 'will be terminated'). A single case of severe abuse, or a channel dedicated to violations, can be terminated directly. Strikes and terminations can be appealed. For metadata violations, a video can be locked as private.

Sources: https://support.google.com/youtube/answer/2802032?hl=en · https://support.google.com/youtube/answer/12950271?hl=en

Source dates: Search extraction 2026-11-23. The wording on 'may' versus 'will' terminate differs between the two pages.

### [corrected] YouTube advertiser-friendly content guidelines: crypto or finance content gets limited ads

No crypto- or finance-specific category exists in the advertiser-friendly guidelines (answer/6162278). The categories are: inappropriate language, violence, adult content, shocking content, harmful acts and unreliable content, hateful and derogatory content, recreational drugs, firearms, controversial issues, sensitive events, enabling dishonest behavior, inappropriate content for kids and families, incendiary and demeaning, and tobacco. Systems check the title, thumbnail, description, tags and the video itself. Context and intent ('to inform and educate') matter. Creators can request human review, and the reviewer's decision is final. A channel that repeatedly self-certifies wrongly can lose ads or be removed from YPP. The changelog (answer/9725604) lists updates in Jan, Feb, Mar, Sep, Oct and Nov 2026, none of them about crypto. The real monetization risk for crypto content comes from the YPP 'inauthentic content' rule and general spam or misleading framing, not from a crypto category.

Sources: https://support.google.com/youtube/answer/6162278?hl=en · https://support.google.com/youtube/answer/9725604?hl=en · https://support.google.com/youtube/answer/9348366?hl=en

Source dates: Search extraction 2026-11-23. Changelog entries are dated Jan–Nov 2026.

### [confirmed] YPP inauthentic content policy (monetization), which affects a templated, code-generated pipeline

On 2025-07-15 YouTube renamed 'repetitious content' to 'inauthentic content' in the channel monetization policies (answer/1311392) and clarified that it covers repetitive or mass-produced content. Examples include templated storylines, image slideshows, scrolling text with little narrative or educational value, and the same situation repeated with the same outcome. Monetization can be removed from the whole channel. The reused content policy was not changed.

Sources: https://support.google.com/youtube/answer/1311392?hl=en · https://support.google.com/youtube/blog/356734251/response-to-creator-questions-about-ypp-policies-july-2025?hl=en-AS

Source dates: Policy change dated 2025-07-15. Search extraction 2026-11-23.

### [confirmed] YouTube paid promotion and branded content rules when promoting crypto products, including your own

The paid-promotion page (answer/154235) is now titled 'Add branded content restrictions & disclosure labels'. A separate 'YouTube Branded Content Policies' page (answer/17596007) also exists. All paid promotions and branded content must follow Google Ads policies (with exceptions where applicable) and the Community Guidelines. 'Financial Services' is a restricted branded-content category, alongside alcohol, gambling, healthcare and elections. Own brands: endorsements are content created for an advertiser '(or for a creator's own brands if the relationship between creator/brand is not clear)'. Ticking the box shows a disclosure label (older text: 10 seconds at the start) and removes the video from YouTube Kids. The page says 'If our systems detect that your newly uploaded video includes branded content that you did not disclose, we may automatically apply the disclosure label on your behalf.' Creators are responsible for disclosure laws in their own jurisdiction.

Sources: https://support.google.com/youtube/answer/154235?hl=en · https://support.google.com/youtube/answer/17596007?hl=en · https://support.google.com/youtube/thread/458476782?hl=en

Source dates: Secondary reports date the rename to 'branded content', the new location and age controls, and automated detection to early September 2026. Official pages were seen via search extraction on 2026-11-23.

### [conflicting_sources] Google Ads 'Cryptocurrencies and related products' policy (governs ads and, through YouTube's rule, branded content)

US rules: ads for exchanges and software wallets require FinCEN MSB registration plus a state money-transmitter license (or a federal or state chartered bank) plus Google certification. Hardware wallets that only hold keys need certification. Coin trusts need Exchange Act Section 12 registration (Form 10-12G). Allowed without certification: businesses that accept crypto as payment, mining hardware, and blockchain services that 'don't market or sell crypto or tokens'. Educational materials are allowed 'provided the content does not offer investment advice, tips, odds, financial calculators or technical trend analysis'. The indexed versions disagree on prohibitions. Version A: 'initial coin offerings, DeFi trading protocols, or the purchase, sale or trade of cryptocurrencies or related products are not allowed... regardless of your location'. Version B lists: 'ICO pre-sales or public offerings, cryptocurrency loans, initial DEX offerings, token liquidity pools, unhosted software wallets, and unregulated dApps', plus 'cryptocurrency trading signals, cryptocurrency investment advice, and aggregators or affiliate sites'. Updates during 2026 were country-specific: Indonesia (Feb), France MiCA CASP (Jul), Iceland, Liechtenstein and Norway (Aug), UAE from 2026-10-21. From May 2026, certification is applied for inside the Ads account.

Sources: https://support.google.com/adspolicy/answer/14009787?hl=en · https://support.google.com/adspolicy/answer/17264747?hl=en · https://support.google.com/adspolicy/answer/18785604?hl=en · https://support.google.com/adspolicy/answer/17067928

Source dates: Policy changelogs dated Feb, May, Jul, Aug and Oct 2026. Search extraction 2026-11-23 shows differing cached versions.

### [confirmed] YouTube External links policy and link mechanics

answer/9054257 prohibits links to: pornography or child sexual abuse material; malware or unwanted software; phishing for 'sign in info, financial info, etc.'; unauthorized access to paid content; terrorist fundraising or recruitment; regulated goods such as drugs, firearms or unlicensed gambling; deceptive content with serious risk of harm; and fake-engagement services. 'Links' include clickable URLs, URL text shown in videos or images, obfuscated URLs ('dot com'), and verbal directions. Telling viewers to copy and paste a non-clickable link to a spammy site also violates the policy. Enforcement is removal plus an email, and 'If we can't verify that a link that you post is safe, we may remove the link.' Mechanics (answer/13748639): clickable external links require 'access to advanced features' (phone verification plus channel history or ID/video verification). URLs in Shorts descriptions and comments and in live chat are not clickable. Channel profile links and long-form descriptions are clickable. A Short can carry a single brand-site link only for a reported brand deal.

Sources: https://support.google.com/youtube/answer/9054257?hl=en · https://support.google.com/youtube/answer/13748639?hl=en · https://support.google.com/youtube/answer/16722303?hl=en

Source dates: Search extraction 2026-11-23

### [confirmed] YouTube online gambling and contest/giveaway rules (relevant to memecoin airdrops and launchpad content)

From 2025-03-19 (announced 2025-03-04), the Illegal or regulated goods policy bars directing viewers to gambling sites or apps not certified by Google. This covers URLs, links in images or text, on-screen logos and verbal mentions. Content promising guaranteed returns can be removed even when the site is certified, and casino content can be age-restricted. The contest policy (answer/1620498) says the creator is 'solely responsible'. Contests must comply with all federal, state and local laws (including US sanctions), have Official Rules linking to the Community Guidelines with all legally required disclosures and a privacy notice, and be free to enter (check lottery laws). They may not manipulate metrics or imply YouTube sponsorship, and may not run through ad units.

Sources: https://support.google.com/youtube/thread/328728041/an-update-to-youtube%E2%80%99s-policies-on-online-gambling-content?hl=en · https://support.google.com/youtube/answer/9229611?hl=en · https://support.google.com/youtube/answer/1620498?hl=en

Source dates: Gambling update effective 2025-03-19. Search extraction 2026-11-23.

### [confirmed] YouTube altered or synthetic (GenAI) content disclosure, which affects TTS voices and animation

answer/14328491 ('Disclosing use of GenAI content') requires disclosure when realistic content makes a real person appear to say or do something they didn't, alters footage of real events or places, or shows a realistic scene that never happened. Not required: clearly unrealistic or animated content (the policy's example is an AI-generated missile in a fully animated video), minor edits, and cloning your own voice for voiceovers or dubs. Labels may still appear in the expanded description for non-photorealistic or animated AI content. Repeatedly failing to disclose can lead to removal or YPP suspension. A YouTube Community post says GenAI labels moved to more prominent locations starting May 2026.

Sources: https://support.google.com/youtube/answer/14328491?hl=en · https://support.google.com/youtube/blog/424874071/updates-to-ai-content-disclosure-and-labels?hl=en

Source dates: Search extraction 2026-11-23. The May 2026 change comes from an official Community blog post.

### [confirmed] Securities Act Section 17(b) anti-touting rule (15 U.S.C. 77q(b))

It is unlawful to publish or circulate any communication that, 'though not purporting to offer a security for sale, describes such security for a consideration received or to be received, directly or indirectly, from an issuer, underwriter, or dealer, without fully disclosing the receipt, whether past or prospective, of such consideration and the amount thereof.' The SEC frames the elements as: (1) circulation through interstate commerce, (2) a communication describing a security, (3) consideration (past, present or future, direct or indirect), and (4) no full disclosure of the consideration and its amount. Scienter is not an element (SEC complaint, W.D. Tex., 2022). The rule applies only when the asset is a 'security' and the payment comes from an issuer, underwriter or dealer. When the creator is the issuer, the risks are instead Section 5 (unregistered offering) and antifraud liability (17(a), 10b-5), if the token is a security or investment contract.

Sources: https://www.law.cornell.edu/uscode/text/15/77q · https://www.govinfo.gov/link/uscode/15/77q · https://www.sec.gov/litigation/complaints/2022/comp-pr2022-167.pdf

Source dates: Statute is current. Search extraction 2026-11-23.

### [confirmed] SEC statements and enforcement on crypto promotion by celebrities and influencers (2017 statement, Mayweather/Khaled 2018, Kardashian 2022, Pierce 2023, Sun plus 8 celebrities 2023, influencer scalping case 2022)

2017-11-01 Enforcement/OCIE statement: anyone promoting a token that is a security 'must disclose the nature, scope, and amount of compensation received'. 2018-11-29 (release 2018-268): Mayweather paid $300,000 disgorgement, a $300,000 penalty and $14,775 interest; DJ Khaled also charged. These were the first ICO touting cases. 2022-10-03 (release 2022-183; order 33-11116, AP 3-21197): Kardashian was paid $250,000 for a 2021-06-13 Instagram post about EMAX that linked to the purchase site. The post carried '#AD', but the payment was not disclosed. She paid about $1.26M (about $260,000 disgorgement including prejudgment interest, plus a $1,000,000 penalty) and accepted a 3-year ban on promoting crypto asset securities. Gensler: the law 'requires them to disclose to the public when and how much they are paid'. Grewal: disclose 'the nature, source, and amount'. 2023-02-17 (2023-34; 33-11157): Paul Pierce received more than $244,000 of EMAX tokens and posted misleading tweets, including a screenshot showing large holdings and profits far above his actual holdings. He paid $1.409M ($1,115,000 penalty plus about $240,000 disgorgement and interest) and accepted a 3-year ban (the FY2023 SEC report says $1.35M). 2023-03-22 (2023-59): Justin Sun and 8 celebrities (Lohan, Jake Paul, Soulja Boy, Mahone, Kendra Lust, Lil Yachty, Ne-Yo, Akon) were charged for touting TRX/BTT without disclosure. A 2026 SEC final judgment filing dismisses the claims against Sun, Tron Foundation and BitTorrent Foundation with prejudice, with Rainberry paying a $10M penalty. 2022-12-14 (2022-221): 8 Twitter/Discord influencers were charged over a $100M 'scalping' scheme: buying, hyping with price targets, then selling without disclosing their intent to sell. The parallel criminal case was reportedly dismissed (secondary source).

Sources: https://www.sec.gov/newsroom/speeches-statements/statement-potentially-unlawful-promotion-icos-sec-statement-urging-caution-around-celebrity-backed-icos · https://www.sec.gov/newsroom/press-releases/2018-268 · https://www.sec.gov/newsroom/press-releases/2022-183 · https://www.sec.gov/files/litigation/admin/2022/33-11116.pdf · https://www.sec.gov/newsroom/press-releases/2023-34 · https://www.sec.gov/files/litigation/admin/2023/33-11157.pdf · https://www.sec.gov/newsroom/press-releases/2023-59 · https://www.sec.gov/files/litigation/litreleases/2026/judgment26496.pdf · https://www.sec.gov/newsroom/press-releases/2022-221

Source dates: Releases dated 2017-11-01, 2018-11-29, 2022-10-03, 2022-12-14, 2023-02-17, 2023-03-22, plus a 2026 judgment. Direct sec.gov fetch blocked; search extraction 2026-11-23.

### [confirmed] SEC staff statement on meme coins (Feb 2025)

Division of Corporation Finance, 2025-02-27: meme coins 'typically are purchased for entertainment, social interaction, and cultural purposes, and their value is driven primarily by market demand and speculation', with limited or no use or functionality. Staff view: transactions in meme coins as described do not involve offers or sales of securities. The view does not extend to coins inconsistent with that description, and staff will look at the economic realities. 'Fraudulent conduct related to the offer and sale of meme coins may be subject to enforcement action or prosecution by other federal or state agencies under other federal and state laws.' 'Neither meme coin purchasers nor holders are protected by the federal securities laws.' Footnote 9: promoter hype on social media and getting listed are not likely to create a reasonable expectation of profits from managerial efforts. The statement is staff guidance only and not Commission-approved. Commissioner Crenshaw dissented the same day ('What Does it Meme?'), calling it 'a roadmap for crypto enterprises looking to evade oversight' and noting pump-and-dumps and rug pulls 'are not uncommon'.

Sources: https://www.sec.gov/newsroom/speeches-statements/staff-statement-meme-coins · https://www.sec.gov/newsroom/speeches-statements/crenshaw-response-staff-statement-meme-coins-022725

Source dates: 2025-02-27. Search extraction 2026-11-23.

### [confirmed] Current (2026) SEC/CFTC posture on memecoins and crypto classification

On 2026-03-17 the SEC issued interpretive Release No. 33-11412, jointly with the CFTC (34-105020), published in the Federal Register 2026-03-23: 'Application of the Federal Securities Laws to Certain Types of Crypto Assets...'. It defines five categories: digital commodities, digital collectibles, digital tools, stablecoins and digital securities. Digital collectibles, which include meme coins (the fact sheet says 'NOT Securities'), are not themselves securities. However, a non-security crypto asset becomes subject to an investment contract when an issuer induces investment with 'representations or promises to undertake essential managerial efforts'. It can later 'separate' when those promises are fulfilled or publicly abandoned. The issuer remains liable for past unregistered offers and for material misstatements about promised efforts. A meme coin can later become a digital commodity if it becomes functional. Howey still governs, and the release binds only the SEC, not courts or private litigants. 'Regulation Crypto Assets' was proposed 2026-08-18 (Release 33-11434, 34-106150; File S7-2026-27; comments closed 2026-10-20) and is not final. It includes a startup exemption of up to $5M over 4 years, a fundraising exemption of up to $75M per 12 months (one commenter describes $20M/$75M tiers), and an 'investment contract' safe harbor. CLARITY Act (H.R. 3633): passed the House 2025-07-17 (294-134) and Senate Banking 2026-05-14 (15-9). Senate cloture on the motion to proceed failed 49-50 on 2026-09-15 (Record Vote 234), and Sen. Tillis moved to reconsider. It is not law as of 2026-11-23.

Sources: https://www.sec.gov/files/rules/interp/2026/33-11412.pdf · https://www.sec.gov/files/33-11412-fact-sheet.pdf · https://www.sec.gov/rules-regulations/2026/08/s7-2026-27 · https://www.sec.gov/files/rules/proposed/2026/33-11434.pdf · https://www.congress.gov/bill/119th-congress/house-bill/3633/all-actions · https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00234.htm

Source dates: Dates 2026-03-17/23, 2026-08-18, 2026-09-15. The exact 'explicit and unambiguous representations' wording comes from law-firm memos (Debevoise, Orrick) and was not seen in the release text. Search extraction 2026-11-23.

### [confirmed] CFTC authority over non-security tokens (fraud and pump-and-dumps)

CFTC customer advisory 'Beware Virtual Currency Pump-and-Dump Schemes' (Feb 2018, still posted): CFTC oversight of commodity cash markets is limited, 'but it maintains general anti-fraud and manipulation enforcement authority over virtual currency cash markets as a commodity in interstate commerce'. It warns against buying tokens on social media tips. A 2024 advisory covers 'cooperative trading projects' (pump-and-dumps) run in messaging-app group chats such as Telegram. No 2025–2026 meme-coin-specific CFTC action was found.

Sources: https://www.cftc.gov/LearnAndProtect/AdvisoriesAndArticles/beware_virtual_currency_pump_dump.html · https://www.cftc.gov/LearnAndProtect/digitalassetfrauds · https://www.cftc.gov/sites/default/files/2024/10/MessagingApps.pdf

Source dates: 2018 advisory and 2024 messaging-app advisory. Search extraction 2026-11-23.

### [conflicting_sources] Private litigation risk for Pump.fun memecoin promoters (Aguilar v. Baton Corp., S.D.N.Y. 1:25-cv-00880-CM)

Secondary sources only (law firms and crypto press). They report that on 2026-08-31 Judge McMahon let civil RICO claims proceed against Baton (Pump.fun) and its founders, finding a plausibly alleged association-in-fact enterprise that includes '25 unidentified memecoin promoters'. Solana Labs, the Solana Foundation and executives were dismissed with prejudice, and an unlicensed money-transmitting theory survived. The sources disagree on which securities claims were dismissed (Law360: against related blockchain projects; Crypto Times: securities and gambling claims against Pump.fun). One source dates the ruling 2025. The docket was not read.

Sources: https://www.courtlistener.com/docket/69593359/aguilar-v-baton-corporation-ltd-dba-pumpfun/ · https://www.wolfpopper.com/news/court-allows-rico-claims-against-pumpfun-and-founders-to-proceed · https://www.cryptotimes.io/2026/09/01/judge-dismisses-pump-fun-securities-claims-clears-solana-labs-and-foundation/

Source dates: Reported ruling date 2026-08-31 (one source says 2025). Not verified against the primary docket.

### [confirmed] FTC Endorsement Guides (16 CFR Part 255) and influencer disclosure rules

Revised Guides announced June 2023 and published in the Federal Register 2023-07-26 (doc 2023-14795). A material connection (money, free products, employment, family, business or ownership ties) must be disclosed 'clearly and conspicuously' when a 'significant minority' of the audience would not expect it. Disclosure is not needed only when the connection is understood by 'all but an insignificant portion' of the audience. The Guides' examples treat part-ownership or a share of sales as connections that must be disclosed. The disclosure must state the nature of the connection, not every detail. Format: visual endorsement means at least a visual disclosure, audible means audible, both means both. On social media the disclosure must be 'unavoidable'. Small white text over a busy image shown for 5 seconds is inadequate. FTC 'Disclosures 101': 'the disclosure should be in the video and not just in the description', and in live streams it should be repeated periodically. Tags and demonstrations can be endorsements.

Sources: https://www.federalregister.gov/documents/2023/07/26/2023-14795/guides-concerning-the-use-of-endorsements-and-testimonials-in-advertising · https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking · https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers

Source dates: FR 2023-07-26. FAQ updated 2023. Search extraction 2026-11-23.

### [confirmed] FTC Consumer Reviews and Testimonials Rule (16 CFR Part 465), with penalties

Published 2024-08-22 and effective 2024-10-21. It bans fake or AI-generated reviews and testimonials, buying positive or negative reviews, undisclosed insider reviews by officers or managers, company-controlled 'independent' review sites, certain review suppression, and buying or selling fake indicators of social media influence (e.g., bought views or followers). Knowing violations can bring civil penalties. The maximum under FTC Act 5(m)(1)(A) is $53,088 per violation (2025 adjustment, effective 2025-01-17). The FTC made no 2026 adjustment because OMB M-26-11 cancelled it, per a September 2026 Federal Register notice.

Sources: https://www.federalregister.gov/documents/2024/08/22/2024-18519/trade-regulation-rule-on-the-use-of-consumer-reviews-and-testimonials · https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials · https://www.federalregister.gov/documents/2025/01/17/2025-01361/adjustments-to-civil-penalty-amounts · https://www.federalregister.gov/documents/2026/09/15/2026-18853/civil-penalty-inflation-adjustments

Source dates: 2024-08-22, 2025-01-17, 2026-09-15. Search extraction 2026-11-23.

### [confirmed] FTC guidance and enforcement specific to crypto promotions

No crypto-specific FTC endorsement rule exists. General FTC Act Section 5 deception law and the Endorsement Guides apply. Relevant actions: the Celsius complaint (2023) says it used YouTube and Twitter marketing videos 'full of false and misleading claims', e.g., that it was 'safer and more stable than a bank'. DK Automation (Nov 2022): unsubstantiated crypto earnings claims and atypical testimonials; the order bans deceptive earnings claims and requires written substantiation. The FTC Data Spotlight (June 2022) found more than $1B in reported crypto scam losses since 2021, with nearly half starting on social media. Consumer guidance: 'if a company or person promises you'll make a profit, that's a scam'. No newer (2025–2026) FTC crypto-advertising guidance was found.

Sources: https://consumer.ftc.gov/cryptocurrency · https://consumer.ftc.gov/consumer-alerts/2023/07/cryptocurrency-deposits-no-returns · https://www.ftc.gov/news-events/news/press-releases/2022/06/new-analysis-finds-consumers-reported-losing-more-1-billion-cryptocurrency-scams-2021 · https://www.ftc.gov/news-events/news/press-releases/2022/11/ftc-takes-action-stop-dk-automation-kevin-david-hulse-pitching-phony-amazon-crypto-moneymaking

Source dates: 2022–2023 materials. Search extraction 2026-11-23.

### [confirmed] Investment-adviser risk for a token-observation bot (publisher's exclusion, Lowe v. SEC)

Lowe v. SEC, 472 U.S. 181 (1985): bona fide publications of general and regular circulation fall outside 'investment adviser'. The SEC applies a 3-part test: impersonal advice, 'bona fide' (genuine and disinterested commentary), and general and regular circulation, not issued 'in response to episodic market activity'. The Court said 'tipsheets' or 'tout sheets' and 'hit and run tipsters' would not qualify. The question is factual. It matters only to the extent the covered tokens are securities, and no crypto-specific application was found.

Sources: https://www.law.cornell.edu/supremecourt/text/472/181 · https://supreme.justia.com/cases/federal/us/472/181/ · https://www.sec.gov/about/offices/oia/oia_investman/rplaze-042012.pdf

Source dates: 1985 decision; 2012 SEC presentation. Search extraction 2026-11-23.

### [confirmed] Non-US exposure: UK FCA cryptoasset financial promotions regime

Since 2023-10-08, promotions of 'qualifying cryptoassets' (fungible and transferable) to UK consumers must be communicated or approved through one of 4 routes: an authorised person; approval by an authorised person; an FCA MLR-registered cryptoasset business; or an FPO exemption. This applies 'regardless of whether the firm is based overseas'. Breaching section 21 FSMA is a criminal offence with up to 2 years' imprisonment and/or an unlimited fine. The FCA named the use of 'finfluencers' as a common issue and issued 450 alerts from 2023-10-08 to 2023-12-31. Whether a Pump.fun memecoin counts as a 'qualifying cryptoasset' is likely (fungible and transferable) but is an inference that was not verified.

Sources: https://www.fca.org.uk/publication/policy/ps23-6.pdf · https://www.fca.org.uk/news/statements/common-issues-crypto-marketing · https://www.fca.org.uk/firms/cryptoassets

Source dates: PS23/6 June 2023; regime live 2023-10-08. Search extraction 2026-11-23.

**Pipeline implications**

- NO RETURN, PRICE OR INVESTMENT LANGUAGE (lint every script, title, description, thumbnail text and caption before render). Block words and phrases: invest/investment/ROI/returns/profit/gains/yield/APY/passive income/100x/1000x/moon/next gem/early/'don't miss'/price target/'going to $X'/'guaranteed'/'risk-free'/'safe'. Basis: the YouTube Spam Policy 'get rich quick investment schemes'; FTC deception and earnings-claim law (DK Automation); the FTC line 'promises you'll make a profit = scam'.
- MEMECOIN FRAMING: describe the community memecoin only as a meme or community or culture token with no utility promises. Scripts must NEVER promise team efforts tied to value: no roadmap, development milestones, exchange listings, buybacks, burns, staking or revenue share, utility in our other products, or 'the dev will...'. Under SEC Release 33-11412 (2026-03-17), issuer 'representations or promises to undertake essential managerial efforts' can attach an investment contract. The issuer stays liable for misstatements even after 'separation'.
- NO CROSS-LINKING OF TOKEN TO PRODUCTS: do not say the token gives discounts, revenue or access on the AI-agent platform or the Telegram bot unless securities counsel signs off. Revenue or profit links push the token toward a 'digital security'.
- DISCLOSURE CARD, REQUIRED IN EVERY VIDEO THAT MENTIONS ANY OF THE 3 PRODUCTS: spoken narration plus on-screen text (large, high-contrast, at least ~5–8 s, not over busy art) near the start AND again right before the product segment. Example: 'I built and own [Product]. I/we hold [N] [TICKER] tokens, about [X]% of supply, as of [date]. Not paid by anyone else for this video.' Repeat it in the first lines of the description. Basis: FTC 16 CFR 255 (a disclosure in the video itself, both audio and visual, 'unavoidable'; a description alone is insufficient).
- THIRD-PARTY TOKEN PAYMENTS: default policy is to accept NO payment, tokens or allocations from other token projects to feature them in videos or in the bot. If an exception is ever made, disclose receipt, source and exact amount in audio and video (Section 17(b); the 2017 SEC statement asks for 'nature, scope, and amount'), tick YouTube's branded-content box, and remember that Google Ads crypto rules apply to branded content.
- HOLDINGS AND TRADING CONDUCT: snapshot dev and creator wallet holdings at publish time and store the snapshot with the video's compliance record. Adopt a no-trade blackout on the memecoin around each upload. The window length is a policy choice, not a legal number; it guards against 'scalping' theories (SEC 2022-221) and CFTC or DOJ fraud exposure. Never show wallet or PnL screenshots or claim holdings or profits (Paul Pierce order 33-11157).
- TELEGRAM BOT FRAMING: call it a 'market data / on-chain observations tool'. Never use signals, calls, alpha, buy/sell, 'bullish on', entries or targets. Demo footage must use synthetic or anonymized token data or clearly past-dated data with no ranking of live tickers. The bot must not send personalized advice or one-off alerts tied to the creator's holdings, which keeps it consistent with the Lowe publisher's-exclusion factors. Note that Google Ads bans ads for 'trading signals' and 'technical trend analysis', so do not buy Google/YouTube ads for the bot.
- AI-AGENT PLATFORM CLAIMS: every factual claim ('noncustodial', 'secure', 'audited', uptime, fees) needs a substantiation file (doc link, audit report, architecture note) before publish. Ban 'safer than a bank', 'risk-free' and 'guaranteed' (Celsius). The platform may be advertised on Google Ads only if it 'doesn't market or sell crypto or tokens' or merely accepts crypto as payment. Never advertise the memecoin through Google Ads.
- GIVEAWAYS AND AIRDROPS: never offer tokens, airdrops or prizes in exchange for likes, subs, comments or shares (Spam Policy engagement manipulation). Default is no crypto giveaways at all. Any contest needs Official Rules under YouTube's contest policy (free entry, legal compliance, privacy notice), and the YouTube Kids/'made for kids' setting must be off.
- WALLET SAFETY: never ask viewers to connect wallets, 'claim', 'verify' or share seed phrases or wallet details, and never link to claim or connect pages. This would trigger the 'Cryptophishing' rule and the External links phishing ban. Add a standing on-screen line: 'We will never DM you or ask for your seed phrase.'
- LINKS: link only to owned domains and the official bot handle. Use no URL shorteners or obfuscated URLs, and do not read out URLs to unvetted sites, because verbal directions also count as links. Enable 'advanced features' (phone plus history or ID verification) so description links are clickable. Shorts description and comment links are NOT clickable, so put links on the channel profile and in long-form descriptions. Every video must deliver standalone value on YouTube (Spam Policy 'off-platform diversion'). Never link to crypto casinos or uncertified gambling sites (rule effective 2025-03-19).
- THUMBNAILS AND TITLES: no cash stacks, rocket or 'up only' charts, '$' multipliers, or fake exchange or celebrity imagery. The title and thumbnail must match the content (Spam Policy 'malicious clickbait'). Do not use exchange, Solana Foundation, Pump.fun or Telegram logos in ways that imply endorsement (Impersonation policy). Never clone a real person's voice in TTS or use celebrity likenesses.
- ANTI-TEMPLATE GUARDRAILS FOR THE REMOTION PIPELINE: vary music beds, scene templates, palettes and structure across videos. Require human-written or edited scripts with real educational narrative. Avoid slideshow or scrolling-text formats. Throttle upload volume. Basis: the Spam Policy's 'automated or synthetic mass production' example (same music plus repetitive AI imagery plus an AI script read aloud) and the YPP 'inauthentic content' rule (2025-07-15), which can demonetize the whole channel.
- YOUTUBE STUDIO SETTINGS PER UPLOAD: set 'not made for kids'. Tick the paid promotion/branded content box on videos whose main purpose is promoting the creator's own products (YouTube counts own brands 'if the relationship between creator/brand is not clear', and auto-labeling of undisclosed branded content is rolling out). Set the GenAI/altered content toggle only if any realistic synthetic depiction exists; fully animated SVG art plus a generic, non-cloned TTS narrator does not require it. Self-certify ad suitability honestly.
- GEOGRAPHY: treat any video promoting the memecoin as reaching UK consumers, where FCA s21 FSMA (criminal) applies to qualifying cryptoasset promotions without an authorised-person route. Either keep the memecoin out of promotional YouTube videos (mention it only factually or not at all) or get UK counsel first. Use branded-content location controls where available.
- CHANNEL RISK ISOLATION: a single severe Spam/Scams violation can terminate a channel. Consider keeping memecoin content off the main product channel so a strike on meme content does not take down the bot and platform channel.
- DISCLAIMERS ARE NOT A SHIELD: 'Not financial advice' or 'DYOR' text may be added, but the linter must still reject return, price and promise language. Disclaimers do not cure an affirmative misleading claim or an undisclosed connection, as the Kardashian '#AD' case shows: the payment amount still had to be disclosed.
- COMPLIANCE RECORD PER VIDEO (store in the repo alongside the render): final script, linter report, disclosure card frames and timestamps, a holdings snapshot, a claims-substantiation list, link list, Studio settings checklist, and the reviewer's name and date.

**Open risks**

- VERIFICATION METHOD: direct fetches of support.google.com, sec.gov, ftc.gov, law.cornell.edu, govinfo.gov and ecfr.gov were blocked by this session's network policy (proxy 403; the Default environment has no allowed hosts). All facts were verified through the WebSearch tool's server-side extraction of those official pages, not by reading the pages directly. Exact quotes should be spot-checked once those hosts are allowed in the session's network settings.
- YouTube's Spam Policy has been reorganized; indexed versions of answer/2801973 differ, and third-party sites date the change to 2026. The branded-content rename and auto-labeling (around Sep 2026) are still rolling out, and the advertiser-friendly guidelines change monthly. Recheck the policy pages before each publishing batch.
- Meme coin non-security status rests on a staff statement (non-binding) and a Commission interpretive release, which per filers and law firms does not bind courts, private plaintiffs or states. Howey still governs. A final 'Regulation Crypto Assets' rule (proposed 2026-08-18) or a revived CLARITY Act in the next Congress could change the analysis.
- Private litigation: the Pump.fun RICO class action (S.D.N.Y. 1:25-cv-00880) reportedly includes '25 unidentified memecoin promoters' in the alleged enterprise. The details come only from secondary sources and the docket was not read. Active memecoin promotion by a Pump.fun 'dev' carries civil RICO and state-law exposure regardless of SEC posture.
- Fraud exposure remains even for non-securities: the CFTC keeps anti-fraud and manipulation authority over virtual-currency cash markets, the FTC Act Section 5 applies, as do DOJ wire fraud and state consumer-protection and securities laws. The SEC staff statement says meme coin buyers are not protected by federal securities laws but that other agencies may act.
- The Google Ads crypto policy text differs between indexed versions (e.g., whether 'purchase, sale or trade of cryptocurrencies' is banned outright, and how trading signals and DeFi are treated). Confirm on the live page before any paid promotion or branded deal.
- Whether a creator's own-product promotion requires YouTube's paid promotion/branded content box is ambiguous ('if the relationship... is not clear'). Automated labeling has no clear appeal path, per secondary reports.
- EU MiCA marketing-communication rules (Art. 7) and other jurisdictions were not verified. The UK FCA's application to Pump.fun memecoins is an inference (qualifying cryptoasset = fungible and transferable).
- Whether the Telegram bot could be treated as investment advice depends on facts and on whether any covered token is a security. No crypto-specific publisher's-exclusion ruling was found.
- AML/money-transmission questions for the noncustodial payment flow (FinCEN guidance on unhosted wallets) and tax were out of scope and not verified.
- No 2025–2026 SEC Section 17(b) crypto-influencer enforcement was found. That suggests lower current SEC appetite, but the statute is unchanged and it has a 5-year civil-penalty limitations window (not verified here). Later administrations can enforce past conduct.
- This is research, not legal advice. Securities counsel should review the memecoin's launch and marketing materials and the disclosure template.

## Text-to-speech options with word/character timestamps (ElevenLabs API and plans, Kokoro / kokoro-onnx, Piper, offline forced alignment), checked 2026-11-23

### [confirmed] ElevenLabs TTS-with-timestamps endpoint is POST /v1/text-to-speech/{voice_id}/with-timestamps on host api.elevenlabs.io

POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps. The streaming version is POST /v1/text-to-speech/{voice_id}/stream/with-timestamps. The SDK's own docstring says it generates 'speech from text with precise character-level timing information'. The SDK also defines regional hosts: api.us.elevenlabs.io, api.eu.residency.elevenlabs.io, api.in.residency.elevenlabs.io and api.sg.residency.elevenlabs.io. Query params: enable_logging (bool; false = zero retention, enterprise only), optimize_streaming_latency (int 0-4) and output_format. output_format values: alaw_8000, mp3_22050_32, mp3_24000_48, mp3_44100_32/64/96/128/192, opus_48000_32/64/96/128/192, pcm_8000/16000/22050/24000/32000/44100/48000, ulaw_8000, wav_8000/16000/22050/24000/32000/44100/48000. The SDK examples use mp3_44100_128. mp3_44100_192 needs Creator tier or above. PCM/WAV at 44.1 kHz needs Pro or above. JSON body fields: text (required), model_id, language_code (ISO 639-1; not supported on multilingual_v2), voice_settings {stability, similarity_boost, style, use_speaker_boost, speed}, pronunciation_dictionary_locators (max 3), seed (0-4294967295), previous_text, next_text, previous_request_ids (max 3), next_request_ids (max 3), use_pvc_as_ivc, apply_text_normalization ('auto'|'on'|'off'), apply_language_text_normalization (Japanese only) and audio_effects. I did not verify the server-side default model_id used when the field is omitted.

Sources: https://files.pythonhosted.org/packages/ea/1b/b757bbd4d3582ca8015ea9c26bd0d578dd96eb33ce8672a03d204ae7a82a/elevenlabs-2.79.0-py3-none-any.whl (elevenlabs/text_to_speech/raw_client.py, elevenlabs/environment.py) · https://pypi.org/pypi/elevenlabs/json

Source dates: Official ElevenLabs Python SDK 2.79.0 (Fern-generated from their API definition), uploaded to PyPI 2026-11-16. elevenlabs.io docs are blocked from this sandbox, so I read the endpoint from the vendor SDK.

### [confirmed] Response shape is audio_base64 + alignment / normalized_alignment with characters, character_start_times_seconds, character_end_times_seconds; timings are character-level, not word-level

The response model is AudioWithTimestampsResponse: { audio_base64: string (base64 audio), alignment: CharacterAlignmentResponseModel | null ('Timestamp information for each character in the original text'), normalized_alignment: CharacterAlignmentResponseModel | null ('...in the normalized text') }. CharacterAlignmentResponseModel = { characters: string[], character_start_times_seconds: float[], character_end_times_seconds: float[] }, and the three arrays line up by index. Timings are CHARACTER-level only. There is no words array, so words have to be built by grouping characters between whitespace. Both alignment objects are typed Optional. ElevenLabs also has a separate POST /v1/forced-alignment (multipart: file + text) that returns { characters[], words[], loss }.

Sources: https://files.pythonhosted.org/packages/ea/1b/b757bbd4d3582ca8015ea9c26bd0d578dd96eb33ce8672a03d204ae7a82a/elevenlabs-2.79.0-py3-none-any.whl (types/audio_with_timestamps_response.py, types/character_alignment_response_model.py, forced_alignment/raw_client.py, types/forced_alignment_response_model.py)

Source dates: SDK 2.79.0, 2026-11-16

### [confirmed] API key header name

The header is xi-api-key: <key>. The SDK's client_wrapper sets headers['xi-api-key']. It also supports Authorization: Bearer <token> for token auth. The official skills repo uses the env var ELEVENLABS_API_KEY.

Sources: https://files.pythonhosted.org/packages/ea/1b/b757bbd4d3582ca8015ea9c26bd0d578dd96eb33ce8672a03d204ae7a82a/elevenlabs-2.79.0-py3-none-any.whl (core/client_wrapper.py) · https://raw.githubusercontent.com/elevenlabs/skills/main/README.md

Source dates: SDK 2.79.0 (2026-11-16); skills repo main read 2026-11-23

### [confirmed] Current ElevenLabs model ids recommended for narration

Official SDK README and official skills repo: eleven_v4 is 'most expressive, highest quality', supports 90+ languages, is 'Recommended for content creation, audiobooks and voiceovers', and is the skills default. eleven_v4 supports only the stability and similarity_boost settings (no style or speed), does not support SSML, and is not available on the stream-input WebSocket. eleven_v4_turbo is real-time (~100 ms). eleven_multilingual_v2 supports 29 languages and is 'Most stable on long-form generations' (previous generation). eleven_flash_v2_5 supports 32 languages with ultra-low latency and costs 50% less per character. Its latency is ~100 ms per the SDK README but ~75 ms per the skills table. eleven_flash_v2 is English-only. eleven_v3 (70+ languages) is the previous-generation expressive model. eleven_turbo_v2 and eleven_turbo_v2_5 are superseded by the Flash models. I did not verify that eleven_v4 returns alignment on /with-timestamps.

Sources: https://raw.githubusercontent.com/elevenlabs/elevenlabs-python/main/README.md · https://raw.githubusercontent.com/elevenlabs/skills/main/text-to-speech/SKILL.md

Source dates: Read 2026-11-23 from GitHub main branches. A search snippet says elevenlabs.io/docs/overview/models was updated about 3 days before 2026-11-23.

### [unverified] ElevenLabs free plan is non-commercial and requires attribution

Search-index text of ElevenLabs' own pages, which I could not fetch: Free = $0 with 10,000 credits/month and no commercial license. The help center says it 'cannot be used for any commercial purpose'. The billing docs say non-commercial use with attribution. Published free-plan (or signed-out) output must credit ElevenLabs by putting 'elevenlabs.io' or '11.ai' in the title. Separately confirmed from the official skills repo: free plans can use pre-made voices through the API, but Voice Library voices fail with HTTP 402 'paid_plan_required'.

Sources: https://raw.githubusercontent.com/elevenlabs/skills/main/text-to-speech/SKILL.md · https://elevenlabs.io/pricing · https://elevenlabs.io/docs/overview/administration/billing · https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform

Source dates: The elevenlabs.io and help.elevenlabs.io pages were seen only as search snippets. Both hosts are blocked by this sandbox's egress proxy, so I could not read them directly. The help article was described as about 929 days old.

### [conflicting_sources] Cheapest commercial ElevenLabs plan: price and monthly quota

Starter is the cheapest plan with a commercial license. Current pricing-page snippet: Starter $6/month with 30,000 credits/month; first month $1 under a Black Friday promotion; annual price = monthly × 10. An older ElevenLabs structured-data snippet and several third-party pages say Starter is $5/month (some explain $5 as the annual-billing equivalent). Other tiers per the current snippet: Creator $22/month with 121,000 credits (older data: 100k), Pro $99/month with 600,000 credits. Credit rates: 1 character = 1 credit on Multilingual v2 (UI). Flash v2.5 is 50% cheaper per character on the API (0.5 credit/char). The pricing page gives a 0.5-1 credit/char range for Flash/Turbo. Per-voice credit multipliers can apply. All products draw from one shared credit pool.

Sources: https://elevenlabs.io/pricing · https://elevenlabs.io/pricing/api · https://raw.githubusercontent.com/elevenlabs/elevenlabs-python/main/README.md

Source dates: Pricing seen only as search snippets around 2026-11-23, with a Black Friday promotion flagged on the page. elevenlabs.io is blocked from this sandbox. Only the '50% lower price per character' for Flash v2.5 is confirmed from the GitHub README.

### [unverified] Commercial rights on paid plans persist after cancellation

Search snippets of the help center and billing docs say all paid plans include a commercial license (except Beta Services). Content generated during a paid subscription keeps an indefinite commercial license after the subscription ends. Audio generated outside a subscription always requires attribution.

Sources: https://help.elevenlabs.io/hc/en-us/articles/15993008593297-What-happens-to-my-content-after-my-subscription-ends · https://elevenlabs.io/docs/overview/administration/billing

Source dates: Search snippet only; I could not fetch the pages.

### [unverified] ElevenLabs terms on Voice Library voices and cloning real people

From search snippets of ElevenLabs' Prohibited Use Policy (elevenlabs.io/use-policy), Voice Library Addendum (elevenlabs.io/vla), and PVC docs and help center. The Prohibited Use Policy bars cloning, synthesizing or impersonating the voice, identity or likeness of any living individual without explicit, informed consent. Professional Voice Cloning is limited to your OWN voice, even if the other person consents. Only your own human-verified Professional clone can be shared in the Voice Library: Instant clones and Voice Design or AI voices cannot be shared, and Illinois residents are excluded. Voice Library voices come with a commercial-use license (on paid plans). ElevenLabs can remove any Voice Library voice at any time without notice. Confirmed separately (official skills repo): the free-plan API cannot use Voice Library voices (402 paid_plan_required). Tutorials also still cite retired voices (Rachel, Charlotte, Josh).

Sources: https://elevenlabs.io/use-policy · https://elevenlabs.io/vla · https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/professional-voice-cloning · https://help.elevenlabs.io/hc/en-us/articles/36842751624209-Can-I-create-a-Professional-Voice-Clone-of-someone-else-s-voice · https://raw.githubusercontent.com/elevenlabs/skills/main/text-to-speech/SKILL.md

Source dates: Policy pages seen as search snippets only (elevenlabs.io blocked). Skills repo read 2026-11-23.

### [confirmed] Kokoro (hexgrad/Kokoro-82M) is Apache-2.0 and its weights are hosted on Hugging Face

The hexgrad/kokoro repo LICENSE is Apache License 2.0. Its README says 'With Apache-licensed weights'. PyPI kokoro 0.9.4 (2025-04-05) has the classifier 'Apache Software License' and requires Python >=3.10,<3.14. The kokoro package downloads everything from huggingface.co with hf_hub_download: repo_id 'hexgrad/Kokoro-82M', files kokoro-v1_0.pth, config.json and voices/{voice}.pt. The Chinese model is at 'hexgrad/Kokoro-82M-v1.1-zh' (kokoro-v1_1-zh.pth). espeak-ng (GPL-3.0) is installed separately for out-of-dictionary English fallback and some languages. The HF model card declares license apache-2.0 and lists 54 voices across 8 languages for v1.0; that card was seen only via search snippet because huggingface.co is blocked here.

Sources: https://raw.githubusercontent.com/hexgrad/kokoro/main/LICENSE · https://raw.githubusercontent.com/hexgrad/kokoro/main/README.md · https://raw.githubusercontent.com/hexgrad/kokoro/main/pyproject.toml · https://raw.githubusercontent.com/hexgrad/kokoro/main/kokoro/model.py · https://pypi.org/pypi/kokoro/json · https://huggingface.co/hexgrad/Kokoro-82M

Source dates: kokoro 0.9.4 released 2025-04-05. GitHub main read 2026-11-23. HF card via search snippet only.

### [confirmed] The `kokoro` Python package returns token/word timestamps

Yes, but only for English (lang_code 'a' = American, 'b' = British). Each KPipeline Result has .tokens: a list of misaki MToken {text, tag, whitespace, phonemes, start_ts, end_ts}. start_ts and end_ts are in seconds and are filled by KPipeline.join_timestamps() from the model's pred_dur (40 frames/s; MAGIC_DIVISOR = 80 half-frames). Timestamps are relative to the start of EACH Result chunk's audio, so cumulative offsets have to be added when concatenating. For non-English languages, Result.tokens is None (no timestamps). The code marks the leading offset as approximate ('TODO: Is -3 an appropriate offset?'). Present in released 0.9.4 and on main.

Sources: https://raw.githubusercontent.com/hexgrad/kokoro/main/kokoro/pipeline.py · https://raw.githubusercontent.com/hexgrad/misaki/main/misaki/token.py · https://files.pythonhosted.org (kokoro-0.9.4-py3-none-any.whl, kokoro/pipeline.py lines 281-385)

Source dates: kokoro 0.9.4 (2025-04-05); main read 2026-11-23

### [confirmed] kokoro-onnx publishes model + voices files as GitHub release assets (avoids huggingface.co)

Yes. The README's current setup links point to https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx and .../model-files-v1.1/voices-v1.0.bin. Asset sizes and Last-Modified dates from HTTP HEAD on the release download URLs (the GitHub API was blocked, so names were probed one by one and the list may be incomplete):
- Tag model-files-v1.1 (all uploaded 2026-08-18 except voices-v1.1-zh.bin, dated 2025-03-01):
  - kokoro-v1.0.onnx: 325,505,369 B
  - kokoro-v1.0.fp16.onnx: 163,527,961 B
  - kokoro-v1.0.int8.onnx: 114,119,327 B
  - voices-v1.0.bin: 28,214,398 B
  - kokoro-v1.1-zh.onnx: 325,506,167 B
  - kokoro-v1.1-zh.fp16.onnx: 163,528,759 B
  - kokoro-v1.1-zh.int8.onnx: 114,120,125 B
  - voices-v1.1-zh.bin: 53,815,880 B
- Tag model-files-v1.0 (2025-01-28 to 2025-02-09):
  - kokoro-v1.0.onnx: 325,532,387 B
  - kokoro-v1.0.fp16.onnx: 177,464,787 B
  - kokoro-v1.0.int8.onnx: 92,361,271 B
  - kokoro-v1.0.fp16-gpu.onnx: 177,464,787 B
  - voices-v1.0.bin: 28,214,398 B
- Tag model-files (v0.19, January 2025):
  - kokoro-v0_19.onnx: 325,525,180 B
  - kokoro-v0_19.int8.onnx: 92,360,686 B
  - voices.bin: 5,758,648 B
  - voices.json: 30,789,387 B
Downloads redirect to release-assets.githubusercontent.com. kokoro-onnx itself is MIT; the README says 'kokoro model: Apache 2.0'. PyPI kokoro-onnx 0.6.1 (2026-08-19) depends on espeakng-loader, phonemizer (GPLv3+), numpy and onnxruntime, and the package makes no Hugging Face calls. The README's voice list still links to the HF VOICES.md.

Sources: https://raw.githubusercontent.com/thewh1teagle/kokoro-onnx/main/README.md · https://raw.githubusercontent.com/thewh1teagle/kokoro-onnx/main/LICENSE · https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx · https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin · https://pypi.org/pypi/kokoro-onnx/json

Source dates: HEAD requests 2026-11-23. v1.1 assets Last-Modified 2026-08-18. kokoro-onnx 0.6.1 uploaded 2026-08-19.

### [confirmed] kokoro-onnx returns timestamps

kokoro-onnx 0.6.1 adds Kokoro.create_timed(text, voice, speed=1.0, lang='en-us', is_phonemes=False, trim=True, sentence_pause=0.25, clause_pause=0.1, continuous=False) -> (audio, sample_rate, list[Timing]). Timing = {phoneme: str, start: float, end: float}, in seconds from the start of the audio. These are PHONEME-level (word boundaries have to be derived from space phonemes), and the list is empty unless the ONNX graph has a 'duration' output (has_timings). Byte inspection of the release files: model-files-v1.1/kokoro-v1.0.int8.onnx contains the I/O names input_ids/style/speed/waveform/duration, while model-files-v1.0/kokoro-v1.0.int8.onnx contains tokens/style/speed/audio with no duration. So only the v1.1-tag exports give timings. scripts/export.py exports output_names=['waveform','duration'] and notes that quantized copies predict slightly different durations. create() wraps create_timed and drops the timings.

Sources: https://raw.githubusercontent.com/thewh1teagle/kokoro-onnx/main/src/kokoro_onnx/__init__.py · https://raw.githubusercontent.com/thewh1teagle/kokoro-onnx/main/src/kokoro_onnx/sliding.py · https://raw.githubusercontent.com/thewh1teagle/kokoro-onnx/main/scripts/export.py · https://files.pythonhosted.org/packages/60/e1/a27e5a70a525a5ee1fd5357596f07b724d02ff317f134e86cb6e3d9db968/kokoro_onnx-0.6.1-py3-none-any.whl

Source dates: kokoro-onnx 0.6.1 (2026-08-19). Release ONNX tails inspected 2026-11-23 (int8 files only; the fp32 graph was not inspected).

### [confirmed] Piper TTS repository status and license (rhasspy/piper archived; moved to OHF-Voice/piper1-gpl; MIT vs GPL-3.0)

The rhasspy/piper README now consists only of 'Development has moved: https://github.com/OHF-Voice/piper1-gpl'. The GitHub page shows it archived by the owner on 2025-10-06 (that date comes from a search snippet; I could not open the GitHub HTML). The old repo's LICENSE.md is MIT. OHF-Voice/piper1-gpl is GPL-3.0 (COPYING), and PyPI piper-tts 1.8.0 (2026-09-04) declares GPL-3.0-or-later. The engine embeds espeak-ng and is installed with 'pip install piper-tts'. The Open Home Foundation says it is looking for maintainers.

Sources: https://raw.githubusercontent.com/rhasspy/piper/master/README.md · https://raw.githubusercontent.com/rhasspy/piper/master/LICENSE.md · https://raw.githubusercontent.com/OHF-Voice/piper1-gpl/main/README.md · https://raw.githubusercontent.com/OHF-Voice/piper1-gpl/main/COPYING · https://pypi.org/pypi/piper-tts/json · https://github.com/rhasspy/piper

Source dates: piper-tts 1.8.0 uploaded 2026-09-04. Archive date 2025-10-06 from search snippet.

### [confirmed] Where Piper voices are hosted and their per-voice licenses

Voices are hosted on Hugging Face at rhasspy/piper-voices. download_voices.py uses https://huggingface.co/rhasspy/piper-voices/resolve/main/{lang_family}/{lang_code}/{voice_name}/{voice_quality}/{lang_code}-{voice_name}-{voice_quality}{.onnx|.onnx.json} and voices.json. Each voice needs a .onnx and a .onnx.json. The Piper project grants NO license over voices. Each voice's MODEL_CARD 'License' line covers only that voice's own dataset, and the 'Training' line has to be walked back to the voice trained from scratch.
- Lessac base: en_US-lessac-medium uses the Blizzard 2013 corpus, licensed for 'research and exploration of speech technologies' with commercial use excluded. Many voices descend from it.
- Retraining: voices are being retrained in late 2026 onto two bases, nl_BE-rdh-medium (CC0) and en_US-hifi_tts_92-medium (CC BY 4.0, which carries attribution). Retrained voices keep their names, so a copy downloaded before the retrain does not qualify.
- English voices on the official commercial-chain list:
  - en_US-joe-medium and en_US-mike-medium (CC0, rdh base)
  - en_US-hifi_tts_92-medium (CC BY 4.0)
  - en_US-kathleen-medium (CC0, hifi base, so CC BY attribution applies)
  - en_GB-alba-medium and en_GB-cori-medium (CC BY 4.0)
  - en_GB-jenny_dioco-medium (custom license: the voice must be called 'Jenny')
  - Public domain: en_US-ljspeech-high/-medium, en_US-kristin-medium, en_US-john-medium, en_US-norman-medium, en_GB-cori-high
  - en_US-libritts-high (CC BY 4.0)
- Not commercial-safe: anything descended from lessac or ryan, en_US-amy-medium (no documented license), en_US-hfc_female-medium (CC BY-NC-SA).

Sources: https://raw.githubusercontent.com/OHF-Voice/piper1-gpl/main/docs/VOICES.md · https://raw.githubusercontent.com/OHF-Voice/piper1-gpl/main/docs/LICENSING.md · https://raw.githubusercontent.com/OHF-Voice/piper1-gpl/main/docs/COMMERCIAL_USE.md · https://raw.githubusercontent.com/OHF-Voice/piper1-gpl/main/src/piper/download_voices.py

Source dates: piper1-gpl main read 2026-11-23. The docs refer to retraining in late 2026.

### [confirmed] Piper outputs timings/alignment

Piper has only experimental PHONEME-level alignment, with no word timestamps. Enable it with PiperVoice.load(path, include_alignments=True), which needs the 'onnx' package (pip install 'piper-tts[alignment]'), or patch the model once with python3 -m piper.patch_voice_with_alignment /path/model.onnx. AudioChunk then gains phonemes, phoneme_ids, phoneme_id_samples (audio sample count per phoneme id) and phoneme_alignments. These are absent if the model is unpatched or alignment is disabled. The C++ piper_audio_chunk has an alignments[] array. Present in the piper-tts 1.8.0 wheel (patch_voice_with_alignment.py; voice.py include_alignments).

Sources: https://raw.githubusercontent.com/OHF-Voice/piper1-gpl/main/docs/ALIGNMENTS.md · https://files.pythonhosted.org (piper_tts-1.8.0-cp39-abi3-manylinux_2_17_x86_64...whl)

Source dates: piper-tts 1.8.0, 2026-09-04

### [confirmed] Free local word-timestamp / forced-alignment options and where their models download from

- stable-ts (MIT; PyPI 2.19.1, 2025-08-16): TRUE alignment of known text at word level. Python: model.align('audio.mp3', text, language='en'). CLI: stable-ts audio.mp3 --align text.txt --language en. Uses openai-whisper models (openai-whisper 20250625, MIT), downloaded from https://openaipublic.azureedge.net/main/whisper/models/<sha256>/<name>.pt (not Hugging Face). It also accepts faster-whisper models.
- whisper.cpp (MIT): transcription with experimental word-level timestamps via '-ml 1' (--max-len 1), token-level timing via '--dtw', and full JSON via '-ojf'. Models come from https://huggingface.co/ggerganov/whisper.cpp through models/download-ggml-model.sh.
- Remotion's @remotion/install-whisper-cpp 4.0.546 (npm, published 2026-11-23): downloadWhisperModel fetches https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin. Its transcribe({tokenLevelTimestamps:true}) passes '--dtw', and the package also exports toCaptions/convertToCaptions.
- faster-whisper (MIT; 1.2.1, 2025-10-31): transcribe(..., word_timestamps=True) gives segment.words with .start, .end and .word. Models are snapshot-downloaded from HF, Systran/faster-whisper-{tiny..large-v3} (turbo: mobiuslabsgmbh/faster-whisper-large-v3-turbo). A local model directory can be passed for offline use.
- Montreal Forced Aligner (MIT; 3.4.4, 2026-11-16; Kaldi-based; installed via conda-forge): true forced alignment. 'mfa model download' lists models through https://api.github.com/repos/MontrealCorpusTools/mfa-models/releases, with tags named {type}-{name}-v{version}. Assets:
  - acoustic-english_mfa-v3.1.0/english_mfa.zip: 92,170,811 B
  - dictionary-english_us_mfa-v3.1.0/english_us_mfa.dict: 3,113,506 B
  - acoustic-english_us_arpa-v3.0.0/english_us_arpa.zip: 91,928,208 B
  - dictionary-english_us_arpa-v3.0.0/english_us_arpa.dict: 7,186,498 B
  3.4.x also adds an optional Hugging Face model path (huggingface_hub).
- aeneas (AGPL-3.0; 1.7.3, last PyPI release 2017-03-16; tested on Python 2.7/3.5): needs ffmpeg, ffprobe and eSpeak, and downloads no models. Its README says word-level alignment was 'not designed' for it but is possible with --presets-word.

Sources: https://raw.githubusercontent.com/jianfch/stable-ts/main/README.md · https://raw.githubusercontent.com/jianfch/stable-ts/main/LICENSE · https://raw.githubusercontent.com/openai/whisper/main/whisper/__init__.py · https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/README.md · https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/models/download-ggml-model.sh · https://registry.npmjs.org/@remotion%2finstall-whisper-cpp · https://raw.githubusercontent.com/SYSTRAN/faster-whisper/master/README.md · https://raw.githubusercontent.com/SYSTRAN/faster-whisper/master/faster_whisper/utils.py · https://raw.githubusercontent.com/MontrealCorpusTools/Montreal-Forced-Aligner/main/README.md · https://files.pythonhosted.org (montreal_forced_aligner-3.4.4-py3-none-any.whl, models/classes.py) · https://github.com/MontrealCorpusTools/mfa-models/releases/download/acoustic-english_mfa-v3.1.0/english_mfa.zip · https://raw.githubusercontent.com/readbeyond/aeneas/master/README.md · https://pypi.org/pypi/stable-ts/json · https://pypi.org/pypi/faster-whisper/json · https://pypi.org/pypi/montreal-forced-aligner/json · https://pypi.org/pypi/aeneas/json

Source dates: All read 2026-11-23. Versions and dates as listed above. The MFA asset sizes come from HEAD requests (assets dated 2024-02-24 and 2024-06-16). openaipublic.azureedge.net is blocked in this sandbox, so Whisper .pt sizes were not checked.

**Pipeline implications**

- ElevenLabs path: call POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps with header 'xi-api-key: $ELEVENLABS_API_KEY' and 'Content-Type: application/json'. Body: {text, model_id, voice_settings?, seed?, previous_text?/next_text?, apply_text_normalization?}. Base64-decode audio_base64 into an .mp3 (output_format=mp3_44100_128 query param). Do not request wav_44100/pcm_44100 (Pro tier) or mp3_44100_192 (Creator tier) on Starter.
- Timings from ElevenLabs are per character. Build word timings by grouping alignment.characters between whitespace: word.start = first char start, word.end = last char end. Use 'alignment' (original text) for on-screen captions so they match the script. 'normalized_alignment' follows normalized text (numbers and symbols spelled out) and will not match tickers like '$SOL'. Guard against alignment being null (both fields are Optional) and fall back to forced alignment.
- Convert seconds to Remotion frames with frame = Math.round(seconds * fps). With chunked TTS, add each chunk's cumulative audio offset before converting, because the kokoro Result chunks and per-request ElevenLabs alignments both start at 0.
- Licensing gate: do NOT publish ElevenLabs Free-plan audio on the promotional channel (no commercial license; attribution 'elevenlabs.io' or '11.ai' in the title). Budget at least the Starter plan ($6/month per the current pricing page, $5 on older listings; 30,000 credits ≈ 30k chars on multilingual/v3-class models, about 2x on Flash v2.5) and generate all release audio while the subscription is active.
- Use only ElevenLabs pre-made voices (free API) or a paid plan with Voice Library voices or a clone of the creator's own voice. Never clone or impersonate any real person (influencers, crypto personalities). Do not hard-code retired voice IDs (Rachel, Charlotte, Josh). List premade voices via GET /v1/voices and pin the voice_id in config.
- Prefer model_id 'eleven_v4' for narration quality (only stability/similarity_boost settings, no SSML). Use 'eleven_multilingual_v2' for very long single generations, or 'eleven_flash_v2_5' to halve credit use. Test that the chosen model returns non-null alignment on /with-timestamps before committing.
- $0 local default: pin kokoro-onnx==0.6.1. Download models from GitHub releases only: https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx (325,505,369 B) or kokoro-v1.0.int8.onnx (114,119,327 B), plus voices-v1.0.bin (28,214,398 B). Verify byte sizes and record SHA-256 in the repo. Use the model-files-v1.1 tag, NOT v1.0, because only v1.1 exports have the 'duration' output needed by create_timed().
- kokoro-onnx create_timed() returns PHONEME timings (Timing.phoneme/start/end). Derive word spans by splitting on space phonemes and mapping back to script words in order, then snap caption words to those spans. For exact word timing on known script text, run stable-ts model.align(audio, script_text, language='en') as a check or replacement.
- If using the PyTorch 'kokoro' package instead (English 'a'/'b' only), read Result.tokens[i].start_ts/end_ts (word-level, seconds, relative to each Result chunk). Note it fetches weights and voices from huggingface.co/hexgrad/Kokoro-82M at runtime, so pre-cache them, because huggingface.co may be blocked in CI or sandboxes.
- Piper: use only voices on piper1-gpl docs/COMMERCIAL_USE.md (e.g. en_US-joe-medium, en_US-mike-medium, en_US-ljspeech-high, en_US-norman-medium, en_US-kristin-medium). Re-download post-retrain copies and check that the MODEL_CARD 'Training' line names rdh or hifi_tts_92 rather than lessac. Keep the MODEL_CARD next to each voice. Add CC BY credits (e.g. Hi-Fi TTS dataset) to the video description when required. Never use en_US-lessac-*, en_US-amy-*, or hfc_* voices.
- Piper gives only phoneme sample counts (include_alignments=True needs 'piper-tts[alignment]'), so pair Piper with a forced aligner for word captions.
- Forced-alignment fallback order for known scripts: (1) stable-ts align() (MIT; openai-whisper weights from openaipublic.azureedge.net); (2) MFA 3.4.4 via conda (models from GitHub releases MontrealCorpusTools/mfa-models, english_mfa v3.1.0 + english_us_mfa v3.1.0 dict). Use plain-transcription word timestamps (whisper.cpp '-ml 1' / '--dtw', faster-whisper word_timestamps=True, @remotion/install-whisper-cpp tokenLevelTimestamps) only as a last resort, because ASR will garble token names and tickers. Avoid aeneas (2017, AGPL-3.0).
- Cache every model file outside the repo, with pinned URLs and checksums, so renders are reproducible offline. Treat huggingface.co, elevenlabs.io and openaipublic.azureedge.net as optional network dependencies that may be blocked in CI.

**Open risks**

- This session's egress proxy blocked elevenlabs.io, help.elevenlabs.io and huggingface.co, so I could not read ElevenLabs pricing, terms, the Prohibited Use Policy, the Voice Library Addendum or the Kokoro HF model card directly. Those facts come from search-index snippets of the official pages and are marked unverified or conflicting. Re-check https://elevenlabs.io/pricing and https://elevenlabs.io/terms-of-use before buying, especially since a Black Friday promotion was active on 2026-11-23.
- The Starter price conflicts ($6/month on the current pricing page vs $5/month on older ElevenLabs structured data and third-party pages). Credit counts for Creator also differ (121,000 vs 100,000).
- Not verified: that eleven_v4 returns non-null alignment on /with-timestamps, and which model the API uses when model_id is omitted.
- The ElevenLabs Prohibited Use Policy may restrict financial or crypto promotional claims (fraud, scams, misleading content). I could not read the exact wording. Avoid investment-return claims in AI-voiced scripts for the memecoin and token-scanner projects.
- Kokoro timestamps are model-predicted durations, not measured alignment. The kokoro code flags its offset as a TODO, and quantized ONNX models predict slightly different durations than fp32. Expect small (tens of ms) caption drift and validate visually.
- I enumerated kokoro-onnx release assets by probing filenames (the GitHub API was blocked), so other assets may exist. Only the int8 v1.1 and v1.0 graphs were byte-inspected for the 'duration' output. I assumed the fp32 and fp16 v1.1 files match because they share an export script and upload date.
- Piper voices are being retrained under unchanged filenames (late 2026), so a cached copy can silently be the non-commercial lessac-derived version. Always check the MODEL_CARD of the exact file. The Piper project gives no legal assurance on voice licensing.
- kokoro-onnx pulls in phonemizer (GPLv3+) and espeak-ng via espeakng-loader. Piper's engine is GPL-3.0-or-later. Running them locally to make audio is fine, but redistributing a bundled app that includes them has GPL obligations.
- rhasspy/piper's archive date (2025-10-06) comes from a GitHub search snippet. The 'moved' notice itself was read directly from the README.
- Whisper-based tools (whisper.cpp, faster-whisper) are ASR, not true forced alignment, and can misrecognize crypto jargon. I verified stable-ts align() and MFA from docs and code, but did not run them in this sandbox.

## YouTube Data API v3 for automated uploads: quota (default allocation, conflicting videos.insert cost), the July 2020 private-only rule for unverified projects, the audit and policy process, per-channel upload limits, and the Studio-vs-API disclosure fields (made for kids, paid promotion, altered content). Checked 2026-11-23. How this was verified: this session's network blocked developers.google.com, support.google.com, youtube.com and web.archive.org, so neither WebFetch nor curl could open them. Content from those pages was read through the WebSearch tool's indexed reads, using several consistent queries per fact. Two Google sources were read directly: the live YouTube Data API discovery document (https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest, revision 20261119) and dated historical copies of it in googleapis/google-api-go-client on raw.githubusercontent.com. Where the discovery document backs up a fact, that is noted.

### [corrected] The default YouTube Data API v3 quota is 10,000 units per day per project.

Since June 1, 2026 quota has been 'granular'. The revision history says the API is 'transitioning to a granular quota system covering smaller sets of methods, starting with videos.insert and search.list'. Calls to those two methods are 'charged to their own respective quota buckets', and all other methods go to the existing bucket. The Overview and the Quota and Compliance Audits page state the default as: 'Projects that enable the YouTube Data API have a default quota allocation of 100 search.list calls, 100 videos.insert calls, and 10,000 units per day combined for all other endpoints.' The Overview adds that the default is subject to change, quotas reset at midnight Pacific Time, every request (invalid ones included) costs at least 1 unit, reads usually cost 1 unit and writes usually 50. A June 3, 2026 entry also added videos.batchGetStats with its own bucket (1 unit per call, 10,000 units/day default). The live discovery document lists videos.batchGetStats (GET youtube/v3/videos:batchGetStats), and it first appears in discovery revision 20260604, which fits the June 2026 entries. The actual limits per project appear in Google Cloud Console > IAM & Admin > Quotas.

Sources: https://developers.google.com/youtube/data/getting-started · https://developers.google.com/youtube/data/guides/quota_and_compliance_audits · https://developers.google.com/youtube/data/revision_history · https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest · https://raw.githubusercontent.com/googleapis/google-api-go-client/v0.284.0/youtube/v3/youtube-api.json

Source dates: Revision history entries: 2026-06-01 (granular quota) and 2026-06-03 (batchGetStats). Discovery doc revision 20261119, fetched 2026-11-23. Discovery rev 20260604 (go-client v0.284.0) already has batchGetStats. developers.google.com pages were read through the search index, not fetched directly.

### [conflicting_sources] videos.insert quota cost (pages reportedly conflict: 1600 vs 100).

Four different answers, by page. (a) Quota Calculator (developers.google.com/youtube/v3/determine_quota_cost?hl=en, indexed copy): still lists videos 'list 1 insert 1600 update 50' and says 'videos.insert has the highest cost of 1600 points'. (b) Revision history, 2025-12-04: 'the documentation and Quota Calculator were updated to reflect a change in the quota cost of a video upload from approximately 1600 units to approximately 100 units'. An older 2013 entry records the drop from about 16000 to 1600. (c) Revision history, 2026-06-01: videos.insert moved to its own quota bucket. (d) videos.insert reference page: 'A call to this method has a quota cost of 1 unit in the Video Uploads quota bucket', quota impact '100 calls per day'. The Quota and Compliance Audits page and the Overview give no per-call unit cost. They state only the default allocation of '100 videos.insert calls' per day, separate from the 10,000-unit pool. The discovery document (rev 20261119) has no quota text for videos.insert. Best reading of the newest sources: 1 unit per call from a separate Video Uploads bucket capped at 100 calls/day/project, so the 1600 on the calculator is stale. This could not be checked against the live calculator.

Sources: https://developers.google.com/youtube/v3/determine_quota_cost?hl=en · https://developers.google.com/youtube/data/determine_quota_cost · https://developers.google.com/youtube/data/revision_history · https://developers.google.com/youtube/v3/docs/videos/insert · https://developers.google.com/youtube/data/guides/quota_and_compliance_audits · https://developers.google.com/youtube/data/getting-started · https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest

Source dates: Revision history entries 2025-12-04 and 2026-06-01. Calculator copy undated (indexed). Read through the search index because developers.google.com was blocked in this session.

### [confirmed] thumbnails.set quota cost

About 50 units. The thumbnails.set page says 'A call to this method has a quota cost of approximately 50 units', and the Quota Calculator lists thumbnails set = 50. Since June 2026 this comes out of the general 10,000-unit bucket. Discovery doc: POST https://youtube.googleapis.com/upload/youtube/v3/thumbnails/set with query parameter videoId, accepting image/jpeg, image/png and application/octet-stream, discovery maxSize 52428800 bytes. The reference page's own per-image size limit could not be read directly.

Sources: https://developers.google.com/youtube/v3/docs/thumbnails/set · https://developers.google.com/youtube/v3/determine_quota_cost?hl=en · https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest

Source dates: Discovery rev 20261119. Doc pages read through the search index.

### [confirmed] videos.update quota cost

50 units, per the Quota Calculator (videos 'update 50'), and consistent with the general rule that writes usually cost 50. Discovery doc: PUT https://youtube.googleapis.com/youtube/v3/videos. Allowed scopes are youtube, youtube.force-ssl and youtubepartner. youtube.upload is not enough. Updating a part overwrites every mutable property in that part, and omitted ones are reset. The videos.update docs list status.selfDeclaredMadeForKids and status.containsSyntheticMedia as exceptions that change only when explicitly set.

Sources: https://developers.google.com/youtube/v3/determine_quota_cost?hl=en · https://developers.google.com/youtube/v3/docs/videos/update · https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest

Source dates: Discovery rev 20261119. Doc pages read through the search index.

### [confirmed] captions.insert quota cost

400 units. The captions.insert page and the Quota Calculator both give 400 ('captions list 50 insert 400 update 450'). captions.update costs 450. Discovery doc: POST https://youtube.googleapis.com/upload/youtube/v3/captions, maxSize 104857600 bytes. Allowed scopes are only youtube.force-ssl and youtubepartner, not youtube.upload.

Sources: https://developers.google.com/youtube/v3/docs/captions/insert · https://developers.google.com/youtube/data/reference/rest/v3/captions/insert · https://developers.google.com/youtube/v3/determine_quota_cost?hl=en · https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest

Source dates: Discovery rev 20261119. Doc pages read through the search index.

### [corrected] Videos uploaded through unverified API projects created after July 28, 2020 stay private until the project passes an audit.

This rule has been REVERSED. The revision history has a 2026-11-02 entry saying videos uploaded through videos.insert from unverified API projects are no longer restricted to private viewing mode, reversing the policy announced July 28, 2020. Google's discovery document backs this up directly. The status.privacyStatus description now reads: 'In a `videos.insert` request, if you don't specify a value for this property, the uploaded video's privacy status defaults to `public`. Certain uploads might default to `private` based on creator account settings, as explained in the YouTube Help Center (support.google.com/youtube/answer/157177). Videos uploaded from unverified API projects are not restricted to private viewing mode.' In the go-client discovery copies this text first appears at revision 20261012 (v0.304.0) and is missing at 20261001 (v0.303.0). Every earlier copy back to 2023 says only 'The video's privacy status.' Older cached copies of the videos and videos.insert pages, and many 2026 third-party guides, still show the 2020 rule.

Sources: https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest · https://raw.githubusercontent.com/googleapis/google-api-go-client/v0.303.0/youtube/v3/youtube-api.json · https://raw.githubusercontent.com/googleapis/google-api-go-client/v0.304.0/youtube/v3/youtube-api.json · https://developers.google.com/youtube/data/revision_history · https://developers.google.com/youtube/v3/docs/videos/insert · https://developers.google.com/youtube/data/reference/rest/v3/videos

Source dates: Revision history entry 2026-11-02. Discovery text present from rev 20261012, live rev 20261119 fetched 2026-11-23. The discovery doc was read directly. The revision history was read through the search index.

### [confirmed] Audit and quota-extension process

An audit is needed only to get MORE than the default allocation. Per the Quota and Compliance Audits page, the audit confirms compliance with the YouTube API Services Terms of Service and gives YouTube insight into how large projects intend to use the API. You start it by submitting the 'YouTube API Services - Audit and Quota Extension Form' (https://support.google.com/youtube/contact/yt_api_form), and a member of the API Services team then contacts you. The form covers (i) your business, (ii) your API client, and (iii) the client's access to and use of YouTube API Services. It asks for detailed usage, including expected growth and daily call patterns. Related forms: developers audited and passed in the last 12 months use the Audited Developer Requests form (https://support.google.com/youtube/contact/yt_api_audited_developer_requests_form). Denied or failed requests go to the Appeals form (https://support.google.com/youtube/contact/yt_api_appeals). Developers invited to periodic audits use a separate Periodic Audit Form. A change of control (merger, sale) needs a Change of Control Form. Developer Policies: extended quota may be used only for the approved use case, and a changed use case needs a new audit. The 2026-06-01 entry says per-method buckets let YouTube approve increases based on specific method usage, and points to the Quota Extension Form. The Cloud Console shows the limits.

Sources: https://developers.google.com/youtube/data/guides/quota_and_compliance_audits · https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits?hl=en · https://support.google.com/youtube/contact/yt_api_form?hl=en · https://support.google.com/youtube/contact/yt_api_audited_developer_requests_form · https://support.google.com/youtube/contact/yt_api_appeals · https://developers.google.com/youtube/terms/developer-policies · https://developers.google.com/youtube/data/revision_history

Source dates: The search index said the audits page was updated about 70 days before 2026-11-23 (exact date not seen). Revision history entry 2026-06-01. All read through the search index.

### [confirmed] YouTube API Services Terms and Developer Policies requirements a small creator automation must meet

Applies to all projects: accept the YouTube API Services Terms of Service. Each API client that needs credentials has exactly one API project, which may not be shared across clients (Developer Policies III.D). Separate test, dev and prod keys, or separate projects for genuinely different use cases, are allowed. Sharding (creating extra projects for the same use case to get more quota) is prohibited. ToS section 15 lets YouTube set quotas at any time. Violations can lead to reduced quota, revoked API keys and other privileges, or termination. Requirements for clients used by other people (and checked in an audit): show a privacy policy that users accept before use, with a link to Google's security settings page (and to the Google Privacy Policy). Link to the YouTube Terms of Service and bind users to them. Give an easy way to revoke consent and revoke the token programmatically right away. Delete data within 7 calendar days of an in-app revocation and within 30 calendar days of a revocation made on Google's security settings page. Do not keep most authorized data longer than 30 calendar days, and re-confirm authorization every 30 days where longer storage is allowed. Developer Policies III.J has an 'Upload Project' exception for child-directed clients uploading their own videos to their own channels. A single creator uploading to their own channel at default quota needs no audit. The user-facing privacy-policy and link requirements matter mainly if the tool is ever offered to other channels or an audit is requested.

Sources: https://developers.google.com/youtube/terms/developer-policies · https://developers.google.com/youtube/terms/developer-policies-guide · https://developers.google.com/youtube/terms/api-services-terms-of-service

Source dates: No page dates were seen. Read through the search index. The search results warned that clause numbers (III.D, III.J, III.E.4.b) came from snippets.

### [confirmed] Per-channel daily upload limit

A per-channel cap exists, separate from API quota, and YouTube does not publish a number. YouTube Help 'Common uploading errors' (answer 10383400): 'To ensure safety at YouTube, we limit how many videos a channel can upload in a 24-hour period across desktop, mobile, and YouTube API. Limits may vary by country/region or channel history. Copyright strikes may impact channel history eligibility.' Community Guidelines strikes also lower it. 'Higher daily upload limits' are an advanced feature (answer 9891124), unlocked by channel history or ID/video verification. Videos longer than 15 minutes need phone verification (an intermediate feature). Figures on YouTube Community forums (about 10-15 per day typical, up to 100 per day for verified accounts) are unofficial and unverified. This cap applies on top of the API's 100 videos.insert calls/day project bucket.

Sources: https://support.google.com/youtube/answer/10383400?hl=en · https://support.google.com/youtube/answer/9891124?hl=en&co=GENIE.Platform%3DDesktop · https://support.google.com/youtube/answer/9890437?hl=en · https://support.google.com/youtube/answer/171664?hl=en

Source dates: Undated Help pages, read through the search index (support.google.com was blocked in this session).

### [confirmed] Metadata YouTube Studio lets you set at upload: made for kids, paid promotion, altered content

Made for kids: an audience setting on the Basic info (Details) step is required for every video ('Yes, it's made for kids' or 'No'), and it can also be set at channel level, where the per-video setting overrides (answer 9527654). YouTube can override it ('Set to Made for Kids'), and creators can appeal. Paid promotion: a checkbox under Show more / 'Paid promotion' for product placement, sponsorship or endorsement (answer 154235). It adds a viewer disclosure label, and the YouTube Branded Content Policies (answer 17596007) apply, including compliance with Google Ads policies. Altered content: a Yes/No disclosure in the upload flow. The current Help article is titled 'Disclosing use of GenAI content' (answer 14328491, formerly 'Disclosing use of altered or synthetic content') and describes an 'AI use' question in the Attributes section. Disclosure is required for realistic altered or synthetic content: real people shown saying or doing things they did not, altered footage of real events or places, and realistic scenes that never happened. Clearly unrealistic or animated content, beauty filters, color correction and AI-assisted scripts are exempt. Choosing Yes adds a label. Creators who consistently fail to disclose can get a label applied for them, removal, or YPP suspension. The exact current Studio label wording could not be checked directly.

Sources: https://support.google.com/youtube/answer/9527654?hl=en · https://support.google.com/youtube/answer/154235?hl=en-GB · https://support.google.com/youtube/answer/17596007?hl=en · https://support.google.com/youtube/answer/14328491?hl=en&co=GENIE.Platform%3DDesktop

Source dates: Undated Help pages, read through the search index.

### [confirmed] Made for kids is settable via the API as status.selfDeclaredMadeForKids

Yes. VideoStatus has two booleans: selfDeclaredMadeForKids (writable on videos.insert and videos.update, the creator's declaration) and madeForKids (the effective value, which YouTube may override). On videos.update, selfDeclaredMadeForKids changes only when explicitly set. There is a separate guide on reading MFK status at developers.google.com/youtube/data/guides/made_for_kids_status.

Sources: https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest · https://developers.google.com/youtube/v3/docs/videos/update · https://developers.google.com/youtube/data/guides/made_for_kids_status

Source dates: Discovery rev 20261119, read directly. Doc pages read through the search index.

### [confirmed] Altered content is settable via the API as status.containsSyntheticMedia

Yes. Discovery doc: VideoStatus.containsSyntheticMedia is a boolean, 'Indicates if the video contains altered or synthetic media.' The revision history entry of 2024-10-30 says it can be set in videos.insert or videos.update and is returned in the video resource when set. It is absent from discovery rev 20240926 and present from rev 20241203. On videos.update it changes only when explicitly set.

Sources: https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest · https://raw.githubusercontent.com/googleapis/google-api-go-client/v0.200.0/youtube/v3/youtube-api.json · https://raw.githubusercontent.com/googleapis/google-api-go-client/v0.215.0/youtube/v3/youtube-api.json · https://developers.google.com/youtube/data/revision_history · https://developers.google.com/youtube/data/reference/rest/v3/videos

Source dates: Revision history entry 2024-10-30. Discovery revs 20240926 (absent), 20241203 (present), 20261119 (present).

### [conflicting_sources] Paid promotion is settable via the API as paidProductPlacementDetails.hasPaidProductPlacement

The field exists. Discovery doc (rev 20261119, present since at least rev 20240926): Video.paidProductPlacementDetails = VideoPaidProductPlacementDetails {hasPaidProductPlacement: boolean}, described as 'Details about paid content, such as paid product placement, sponsorships or endorsement... This data can only be retrieved by the video owner'. It carries no mutability note and no default. The sources disagree in two places. (1) Default: the indexed revision history has a 2026-11-16 entry saying hasPaidProductPlacement 'no longer defaults to false'. Omitting it in videos.insert or videos.update leaves the video undeclared, so 'false' must be sent explicitly to declare no paid placement. An older cached Videos resource page still says it defaults to false. (2) Availability: the search engine tied a statement from the same entry to it, that 'the resource and its methods are available only to select launch partners (approved Google Cloud projects)' in a pilot, with general availability planned for 2027. It was impossible to tell whether that sentence covers paidProductPlacementDetails or a different resource. Third-party uploaders (for example GitHub porjo/youtubeuploader PR #220, not official) do send the flag through videos.insert.

Sources: https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest · https://developers.google.com/youtube/data/revision_history · https://developers.google.com/youtube/v3/docs/videos?csw=1 · https://developers.google.com/youtube/v3/docs/videos/update

Source dates: Revision history entry 2026-11-16 (read through the search index). Discovery rev 20261119 (read directly). Cached Videos page undated.

### [confirmed] Upload endpoint, size and scopes for videos.insert

Discovery doc: rootUrl https://youtube.googleapis.com/. Media upload is POST /upload/youtube/v3/videos (simple or multipart), with a resumable path of /resumable/upload/youtube/v3/videos. Client libraries normally call /upload/youtube/v3/videos?uploadType=resumable. maxSize is 274877906944 bytes (256 GiB), and the reference page says 256GB. Accepted types: video/*, application/octet-stream. Scopes: youtube, youtube.force-ssl, youtube.upload, youtubepartner. Query parameters: part, notifySubscribers, autoLevels, stabilize, onBehalfOfContentOwner, onBehalfOfContentOwnerChannel. status.publishAt can be set only while privacyStatus is private. In discovery, the reference links now point to developers.google.com/youtube/data/reference/rest/v3/... (the docs moved from /youtube/v3/docs/), while old URLs are still indexed.

Sources: https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest · https://developers.google.com/youtube/v3/docs/videos/insert

Source dates: Discovery rev 20261119, fetched 2026-11-23.

### [confirmed] OAuth refresh tokens for an unverified, 'Testing'-status Google Cloud project expire after 7 days

Google OAuth docs: 'A Google Cloud Platform project with an OAuth consent screen configured for an external user type and a publishing status of "Testing" is issued a refresh token expiring in 7 days', unless only basic identity scopes are requested. YouTube scopes are not identity scopes. Moving to 'In production' removes the 7-day expiry. Unused tokens can still expire after about 6 months. There is a cap of 100 refresh tokens per Google Account per client ID, and the oldest is silently invalidated. The usual failure is invalid_grant 'Token has been expired or revoked'.

Sources: https://developers.google.com/identity/protocols/oauth2 · https://developers.google.com/identity/protocols/oauth2/production-readiness/overview

Source dates: Undated. Read through the search index.

**Pipeline implications**

- Quota budget per published video, using the newest official numbers: videos.insert = 1 unit from the separate Video Uploads bucket (100 calls/day/project). From the 10,000-unit general bucket: thumbnails.set about 50, captions.insert 400, any videos.update 50, playlistItems.insert about 50 (a typical write). That is roughly 550 units per fully dressed upload, about 18 per day from the general bucket. At 1-3 videos a day no audit is needed. Do NOT design around the stale 1600-unit figure, and do NOT hardcode costs: keep them in a config table and check the Cloud Console Quotas page once.
- Use exactly ONE Google Cloud project for the uploader. Never create extra projects to get more quota (sharding is prohibited and can get keys revoked).
- Handle quotaExceeded with backoff until midnight Pacific Time. Treat a per-channel upload-limit error as separate from API quota: the channel's 24-hour cap covers web, mobile and API combined, and its size is not published. Queue the upload and retry the next day rather than hammering the API.
- Always send status.privacyStatus explicitly. Upload as 'private' (or 'unlisted') first, then publish with status.publishAt (allowed only while private) or a later videos.update. After every insert, read status.privacyStatus back from the API response and log it. Since 2026-11-02, unverified projects are no longer locked to private, and the default when the field is omitted is PUBLIC, so an omitted field could publish an unreviewed video. Creator account settings can still force private.
- Set status.selfDeclaredMadeForKids=false explicitly on every videos.insert. The content is crypto/fintech and not made for kids, and the audience question is mandatory.
- Set status.containsSyntheticMedia explicitly on every upload. Stylized SVG animation is exempt from YouTube's realistic-content disclosure, but set it to true if narration uses a cloned voice of a real person or if any photorealistic AI imagery or footage appears. Disclosure does not limit reach or monetization, while repeated non-disclosure can lead to penalties.
- Send paidProductPlacementDetails.hasPaidProductPlacement explicitly (as of 2026-11-16 it reportedly no longer defaults to false). Set it to true whenever any third party, such as a token community, treasury or partner, gives anything of value for the video. Wrap the field in a try/fallback: if the API rejects or ignores it (possible pilot gating), flag the video for a manual Studio 'Paid promotion' checkbox step before publishing.
- OAuth scopes: youtube.upload alone is NOT enough. captions.insert needs youtube.force-ssl (or youtubepartner), and videos.update needs youtube or youtube.force-ssl. Request https://www.googleapis.com/auth/youtube.force-ssl (plus youtube.upload if wanted) once, during a one-time local consent.
- Set the OAuth consent screen to 'In production' (it can stay unverified for the creator's own account, with Google's 'unverified app' warning). If it is left in 'Testing', refresh tokens die after 7 days and unattended uploads fail with invalid_grant. Keep the refresh token in a secret store and alert on invalid_grant.
- Use resumable uploads (POST https://youtube.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status[,paidProductPlacementDetails]) and retry chunks. The file size cap is 256 GB, irrelevant for short animated videos.
- Thumbnails: JPEG or PNG through thumbnails.set (videoId query parameter). Keep files small (aim for 1280x720 and under 2 MB, a conservative target that was not verified here). Custom thumbnails may require the channel's verification or feature eligibility, so treat a thumbnails.set failure as non-fatal.
- Captions: upload the TTS script as a caption track (SRT/VTT) through captions.insert (400 units), or skip it and save quota. Never call captions.update in a loop (450 each).
- In code comments and runbooks, link to the new docs paths (developers.google.com/youtube/data/...) and re-check the revision history before changing quota assumptions. Third-party 2026 guides are often out of date (1600 units, private-lock).
- No audit is needed at default quota for a single creator uploading to their own channel. If the tool is ever offered to other channels or more quota is needed: publish a privacy policy linking Google's Privacy Policy and security settings page, link the YouTube ToS, implement token revocation, delete data within 7 days (in-app revocation) or 30 days (Google-side revocation), keep the 30-day retention and refresh rules, then file the Audit and Quota Extension Form (support.google.com/youtube/contact/yt_api_form).

**Open risks**

- developers.google.com, support.google.com, youtube.com, policies.google.com and web.archive.org were blocked by this session's network policy (proxy 403 / DNS refusal). Everything except the discovery document was read through the WebSearch tool's indexed reads, not a direct page fetch. Re-verify the key numbers by opening the pages directly once developers.google.com and support.google.com are allowed: videos.insert = 1 unit in the Video Uploads bucket, the 100/day bucket, the Nov 2 2026 privacy reversal, and the Nov 16 2026 paid-placement change.
- The Quota Calculator copy still shows videos.insert = 1600, which contradicts the Dec 2025 entry (about 100) and the current reference page (1 unit, separate bucket). Google may still be mid-migration. The Cloud Console Quotas page for the project is the final word.
- paidProductPlacementDetails: the default changed (2026-11-16 per the indexed revision history), and a 'pilot / select launch partners / GA 2027' sentence may restrict API access. Whether ordinary projects can write the field could not be confirmed. Keep the manual Studio fallback.
- The reversal of the private-only rule for unverified projects (2026-11-02) is very recent, and its real-world behavior has no independent confirmation beyond one third-party GitHub PR (2026-11-19). Always check privacyStatus in the response.
- The per-channel 24-hour upload limit is unpublished, varies by region and channel history, and is lowered by strikes. A new channel may have a low cap.
- Content-policy risk not verified here: promoting a memecoin and a token scanner bot falls under YouTube Community Guidelines (scams, spam and deceptive practices, harmful financial content) and, for anything paid, the Branded Content Policies and Google Ads financial-services/crypto rules. A policy strike would also cut the channel's upload limit. Research this separately.
- Exact section numbers of the Developer Policies (III.D, III.J, III.E.4) and the 7-day and 30-day deletion windows came from indexed snippets. Confirm them on the live policy page before quoting them in a privacy policy or audit submission.
- Thumbnail size limit: the discovery maxSize is 50 MB, but the reference page traditionally states a much smaller limit (2 MB) that could not be read directly. Custom-thumbnail eligibility may depend on channel verification.

## Licensing of music, sound effects and fonts for monetized YouTube videos (YouTube Audio Library, SIL OFL 1.1, Google Fonts, Fontsource, Remotion font loading)

### [unverified] (1a) YouTube Audio Library music and sound effects may be used in monetized YouTube videos

NOT VERIFIED FROM THE PRIMARY SOURCE. The official page (https://support.google.com/youtube/answer/3376882) could not be read: this session's network policy blocks support.google.com (agent proxy: 403 'no rule or network setting allows this host'; WebFetch: ENOTFOUND). A search-engine summary credits that page with saying: 'If you're in the YouTube Partner Program, you can monetize videos with music and sound effects from the Audio Library', and that 'copyright-safe music and sound effects downloaded from the Audio Library won't be claimed by a rights holder through the Content ID system'. Treat this as likely but unconfirmed until someone reads the page directly.

Source dates: Could not read the page, so its date is unknown.

### [unverified] (1b) Which Audio Library tracks require attribution, and the required attribution text format

NOT VERIFIED FROM THE PRIMARY SOURCE (support.google.com is blocked here). A search-engine summary of the official help page says: tracks under a Creative Commons license need credit in the video description, even in a video that uses CC music; the attribution text can be copied from the Creative Commons icon in the Audio Library's license column; and the 'Attribution not required' filter shows standard YouTube Audio Library license tracks, which need no attribution. YouTube's exact copy-paste string could not be confirmed. From memory and unverified, it is usually '<Title> by <Artist> is licensed under a Creative Commons Attribution 4.0 license. https://creativecommons.org/licenses/by/4.0/' followed by Source/Artist links. Do not hard-code this; copy YouTube's text verbatim for each track.

Source dates: Could not read the page, so its date is unknown.

### [confirmed] (1b-legal) What the CC BY 4.0 license itself requires when a CC BY track is used in a video

CC BY 4.0, Section 3(a)(1): if You Share the material, You must (A) keep, where the licensor supplies them: the creator identification 'in any reasonable manner requested by the Licensor', a copyright notice, a notice referring to the license, a notice referring to the warranty disclaimer, and a URI or hyperlink to the material 'to the extent reasonably practicable'; (B) 'indicate if You modified the Licensed Material'; (C) state that the material is under CC BY 4.0 and include the text of, or the URI/hyperlink to, the license. Section 3(a)(2) lets you meet these 'in any reasonable manner based on the medium', for example with a link to a page holding the information. Section 1(a) definition: 'where the Licensed Material is a musical work, performance, or sound recording, Adapted Material is always produced where the Licensed Material is synched in timed relation with a moving image'. So a CC BY track placed under video counts as Adapted Material, and the credit should say it was modified or adapted. Section 2(a)(1) grants a 'worldwide, royalty-free, non-sublicensable, non-exclusive, irrevocable' license, and Section 2(a)(4) covers 'all media and formats'. The license text itself has no platform restriction. Canonical URL: https://creativecommons.org/licenses/by/4.0/legalcode.

Sources: https://raw.githubusercontent.com/creativecommons/cc-legal-tools-data/main/docs/licenses/by/4.0/legalcode.en.html

Source dates: CC BY 4.0 legal code (version 4.0). Read from Creative Commons' official cc-legal-tools-data repo (main branch) on 2026-11-23, because creativecommons.org is blocked by this session's network policy.

### [unverified] (1c) Audio Library music may or may not be used outside YouTube (e.g. on X or TikTok); the exact terms

NOT VERIFIED. The official YouTube Help page and the Audio Library terms in YouTube Studio could not be read (support.google.com and studio.youtube.com are blocked here). Search summaries found no official wording on off-platform use. Third-party guides, which are not primary sources and were seen only as search summaries, contradict each other. Some say standard-license tracks are 'restricted to YouTube videos' and that use on other platforms or in podcasts breaks the terms. Others say standard tracks can be used anywhere. Most say CC BY tracks can be used elsewhere with attribution, and some say to contact the artist first. For comparison, YouTube's Creator Music FAQ (seen only as a search summary) says Creator Music licenses are YouTube-only and not transferable. Assume standard-license Audio Library tracks are YouTube-only until the official terms are read.

Source dates: Could not read the page, so its date is unknown.

### [confirmed] (2) SIL Open Font License 1.1 fonts may be embedded or rendered into commercial and monetized videos and thumbnails

YES. OFL 1.1 (version dated 26 February 2007) grants permission 'to use, study, copy, merge, embed, modify, redistribute, and sell modified and unmodified copies of the Font Software'. Condition 5: 'The requirement for fonts to remain under this license does not apply to any document created using the Font Software.' The official SIL OFL-FAQ (Version 1.1-update7, November 2023), Q1.1, explicitly allows use 'for any kind of design work… logos, posters… video titling…' with 'No additional license or permission is required'. Q1.1.1: you remain the copyright holder of the artwork. Q1.1.2: no acknowledgement is required. Q1.26: AI-based design tools may use OFL fonts when the output is not a font. Conditions only apply when the FONT FILES themselves are distributed or modified: (1) the font may not be sold by itself; (2) any redistributed copy must include the copyright notice and the OFL text (Q1.8, Q1.10); (3) a Modified Version may not use Reserved Font Names; (4) author names may not be used to promote Modified Versions; (5) the font must stay under the OFL. Rendered video frames and PNG or JPG thumbnails contain no font software, so none of these conditions apply to them.

Sources: https://raw.githubusercontent.com/google/fonts/main/ofl/anton/OFL.txt · https://raw.githubusercontent.com/silnrsi/font-andika/master/OFL-FAQ.txt

Source dates: OFL text: 'Version 1.1 - 26 February 2007'. OFL-FAQ: 'Version 1.1-update7 - November 2023', read from SIL's own GitHub repo because openfontlicense.org is blocked by this session's network policy.

### [confirmed] (3) Every Google Fonts family is licensed under OFL, Apache 2.0 or UFL, and a specific family's license can be checked

Yes. The METADATA.pb 'license' field documented in googlefonts/gf-docs 'Can contain one of 3 possible values': license: "APACHE2", license: "OFL" or license: "UFL". The google/fonts README says: 'The top-level directories indicate the license of all files found within them'; 'Each family directory contains the appropriate license file'; 'Most of the fonts in the collection use the SIL Open Font License, v1.1. Some fonts use the Apache 2 license. The Ubuntu fonts use the Ubuntu Font License v1.0'; and some OFL fonts use the Reserved Font Name option. How to check one family: (a) fetch https://raw.githubusercontent.com/google/fonts/main/<ofl|apache|ufl>/<familyname-lowercase-no-spaces>/METADATA.pb and read the 'license:' line, plus the OFL.txt or LICENSE.txt in that folder, whose copyright line names any Reserved Font Name ('with Reserved Font Name ...'). Examples checked: ofl/anton = "OFL", ofl/montserrat = "OFL", ofl/inter = "OFL", apache/luckiestguy = "APACHE2", ufl/ubuntu = "UFL". (b) Read the 'license' field of the matching npm package, e.g. node_modules/@fontsource/<family>/package.json shows "OFL-1.1" or "Apache-2.0". (c) The License section of the fonts.google.com specimen page is also a source, but it could not be checked here because fonts.google.com is blocked.

Sources: https://raw.githubusercontent.com/google/fonts/main/README.md · https://raw.githubusercontent.com/googlefonts/gf-docs/main/METADATA/README.md · https://raw.githubusercontent.com/google/fonts/main/ofl/anton/METADATA.pb · https://raw.githubusercontent.com/google/fonts/main/apache/luckiestguy/METADATA.pb · https://raw.githubusercontent.com/google/fonts/main/ufl/ubuntu/METADATA.pb

Source dates: google/fonts and gf-docs main branches, read 2026-11-23 (the files show no dates).

### [confirmed] (4) npm @fontsource packages bundle the font files locally under the font's own license, so fonts install from the npm registry and nothing is fetched from fonts.googleapis.com at render time

Confirmed by unpacking the tarball @fontsource/inter@5.3.0 (published 2026-07-19T03:40:13Z, package.json "license": "OFL-1.1"). It contains files/*.woff2 and *.woff, 252 files in all. Each CSS file (e.g. 700.css) declares @font-face with src: url(./files/inter-latin-700-normal.woff2) format('woff2'), and no CSS file references fonts.googleapis.com. The package ships a LICENSE file with the full OFL 1.1 text and exports './files/*.woff2', so the raw font files can be imported directly. Fontsource docs: 'Fontsource is a collection of open-source fonts that are packaged into individual NPM packages for self-hosting' and 'Your fonts load offline'. Fontsource README: 'Most of the fonts in the collection use the SIL Open Font License, v1.1. Some fonts use the Apache 2 license. The Ubuntu fonts use the Ubuntu Font License v1.0', so the license varies per package (e.g. @fontsource/luckiest-guy is "Apache-2.0"). The google/fonts README names Fontsource for self-hosting: 'all the fonts available here are licensed with permission to redistribute'. The network is only needed once, at npm install time, to reach registry.npmjs.org. Latest checked versions: @fontsource/anton, montserrat, inter and archivo-black are all 5.3.0 and OFL-1.1. @fontsource-variable/inter is 5.3.0 and OFL-1.1.

Sources: https://registry.npmjs.org/@fontsource/inter/-/inter-5.3.0.tgz · https://registry.npmjs.org/@fontsource/inter · https://raw.githubusercontent.com/fontsource/fontsource/main/README.md · https://raw.githubusercontent.com/fontsource/fontsource/main/website/docs/getting-started/introduction.mdx · https://raw.githubusercontent.com/google/fonts/main/README.md

Source dates: @fontsource/* 5.3.0 published 2026-07-19. Fontsource docs from the main branch, read 2026-11-23. fontsource.org itself is blocked by this session's network policy.

### [confirmed] (5) Remotion's guidance on loading fonts: @remotion/google-fonts downloads from Google at render time, whereas local files do not

Confirmed from the Remotion docs source and the package code. @remotion/google-fonts (available since v3.2.40, MIT, latest 4.0.546 published 2026-11-23): loadFont() 'automatically blocks the render until the font is ready'. getInfo() and the returned 'fonts' object hold URLs on https://fonts.gstatic.com/s/... plus a css2 URL on fonts.googleapis.com. In dist/cjs/base.js, each style/weight/subset is fetched over the network with fetchFontData(<gstatic URL>) inside delayRender(label, {timeoutInMilliseconds: 60000}), with 2 retries and a 20 s FontFace load timeout. So rendering needs access to Google's servers. The docs warn that 'A large font file paired with limited bandwidth can lead to a render timeout', tell you to pass a style, weights and subsets, and print a warning above 20 network requests (option ignoreTooManyRequestsWarning, from v4.0.283). Calling loadFont() with no arguments in Remotion 4.0 loads every variant. The docs say that from v5.0 'weights' and 'subsets' are required, but v5 is not on npm: latest is 4.0.546 and alpha is 4.1.0-alpha12. The 'Google Fonts using CSS' method (@import url('https://fonts.googleapis.com/css2?family=...')) also fetches at render time, and 'From version 2.2 on, Remotion will automatically wait until the fonts are loaded'. Local fonts: @remotion/fonts loadFont({family, url: staticFile('X.woff2'), weight}) is MIT, with 4.0.541 and 4.0.546 on npm. The fonts.mdx section marks it AvailableFrom v4.0.164, while the loadFont() page says v4.0.165 (minor doc inconsistency). It blocks the render until loaded, and 'If the font fails to load (for example, the URL returns a 404), the render fails with an error.' Fonts can also be loaded manually with the FontFace API plus delayRender()/continueRender(). Remotion's bundler supports importing .css files and font files (.woff, .woff2, .otf, .ttf, .eot) with 'import' statements.

Sources: https://raw.githubusercontent.com/remotion-dev/remotion/main/packages/docs/docs/fonts.mdx · https://raw.githubusercontent.com/remotion-dev/remotion/main/packages/docs/docs/google-fonts/index.mdx · https://raw.githubusercontent.com/remotion-dev/remotion/main/packages/docs/docs/google-fonts/load-font.mdx · https://raw.githubusercontent.com/remotion-dev/remotion/main/packages/docs/docs/fonts-api/load-font.mdx · https://raw.githubusercontent.com/remotion-dev/remotion/main/packages/docs/docs/fonts-api/index.mdx · https://raw.githubusercontent.com/remotion-dev/remotion/main/packages/docs/docs/troubleshooting/font-loading-errors.mdx · https://raw.githubusercontent.com/remotion-dev/remotion/main/packages/docs/docs/importing-assets.mdx · https://registry.npmjs.org/@remotion/google-fonts/-/google-fonts-4.0.546.tgz · https://registry.npmjs.org/@remotion/fonts

Source dates: Remotion docs from the main branch, read 2026-11-23 (published at https://www.remotion.dev/docs/fonts and /docs/google-fonts, both blocked here). @remotion/google-fonts 4.0.546 published 2026-11-23T09:42:39Z. The project pins remotion 4.0.541.

### [confirmed] (6a) Recommended font: Anton (heavy condensed display face for thumbnail headlines) is licensed under OFL

Anton is OFL 1.1. google/fonts ofl/anton/METADATA.pb has license: "OFL", designer "Vernon Adams", repository_url https://github.com/googlefonts/AntonFont. The OFL.txt copyright line is 'Copyright 2020 The Anton Project Authors (https://github.com/googlefonts/AntonFont.git)' and declares no Reserved Font Name. The upstream OFL.txt in googlefonts/AntonFont matches. npm @fontsource/anton 5.3.0 is "OFL-1.1" with weight [400] only (the design itself is very heavy), normal style, and subsets latin, latin-ext and vietnamese. Use it for thumbnail headlines. Being single-weight and condensed, it suits thumbnails rather than long captions (design judgment, not a verified fact).

Sources: https://raw.githubusercontent.com/google/fonts/main/ofl/anton/METADATA.pb · https://raw.githubusercontent.com/google/fonts/main/ofl/anton/OFL.txt · https://raw.githubusercontent.com/googlefonts/AntonFont/main/OFL.txt · https://registry.npmjs.org/@fontsource/anton/-/anton-5.3.0.tgz

Source dates: google/fonts main branch, read 2026-11-23. @fontsource/anton 5.3.0 published 2026-07-19.

### [confirmed] (6b) Recommended font: Montserrat (geometric sans with weights 100 to 900, for thumbnails and captions) is licensed under OFL

Montserrat is OFL 1.1. google/fonts ofl/montserrat/METADATA.pb has license: "OFL" and a wght axis from 100.0 to 900.0. The OFL.txt copyright line is 'Copyright 2024 The Montserrat.Git Project Authors (https://github.com/JulietaUla/Montserrat.git)' and declares no Reserved Font Name. The upstream OFL.txt at JulietaUla/Montserrat matches. npm @fontsource/montserrat 5.3.0 is "OFL-1.1" with weights [100,200,300,400,500,600,700,800,900], italic and normal styles, and subsets cyrillic, cyrillic-ext, latin, latin-ext and vietnamese. Its LICENSE uses the older line 'Copyright 2011 The Montserrat Project Authors'. Suggested use: 900 (Black) for thumbnails and 700 to 800 for burned-in captions (design judgment).

Sources: https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/METADATA.pb · https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/OFL.txt · https://raw.githubusercontent.com/JulietaUla/Montserrat/master/OFL.txt · https://registry.npmjs.org/@fontsource/montserrat/-/montserrat-5.3.0.tgz

Source dates: google/fonts main branch, read 2026-11-23. @fontsource/montserrat 5.3.0 published 2026-07-19.

### [confirmed] (6c) Recommended font: Inter (highly legible UI sans with weights 100 to 900, for captions and on-screen text) is licensed under OFL

Inter is OFL 1.1. google/fonts ofl/inter/METADATA.pb has license: "OFL", designer "Rasmus Andersson", an opsz axis from 14 to 32 and a wght axis from 100 to 900. The OFL.txt copyright line is 'Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter)' and declares no Reserved Font Name. The upstream https://github.com/rsms/inter LICENSE.txt (master branch) is OFL 1.1. npm @fontsource/inter 5.3.0 is "OFL-1.1" with weights 100 to 900, italic and normal styles. @fontsource-variable/inter 5.3.0 is also OFL-1.1. Alternative single-weight heavy display face: Archivo Black (ofl/archivoblack has license "OFL"; @fontsource/archivo-black 5.3.0 is OFL-1.1 with weight 400 only; source https://github.com/Omnibus-Type/ArchivoBlack). Avoid Luckiest Guy for an OFL-only policy: it is Apache-2.0, which is permissive but a different license.

Sources: https://raw.githubusercontent.com/google/fonts/main/ofl/inter/METADATA.pb · https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt · https://raw.githubusercontent.com/rsms/inter/master/LICENSE.txt · https://registry.npmjs.org/@fontsource/inter/-/inter-5.3.0.tgz · https://raw.githubusercontent.com/google/fonts/main/ofl/archivoblack/METADATA.pb · https://registry.npmjs.org/@fontsource/archivo-black/-/archivo-black-5.3.0.tgz

Source dates: google/fonts main branch, read 2026-11-23. @fontsource/* 5.3.0 published 2026-07-19.

**Pipeline implications**

- Fonts must load offline at render time. Do not use @remotion/google-fonts or a CSS @import of fonts.googleapis.com in the production render path: both fetch from Google during the render, under a 60 s delayRender timeout. Install fonts from npm as @fontsource/<family> pinned to an exact version (e.g. "@fontsource/anton": "5.3.0", "@fontsource/montserrat": "5.3.0", "@fontsource/inter": "5.3.0"). Alternatively, copy the woff2 files into public/fonts/ together with their OFL.txt.
- Load fonts with @remotion/fonts loadFont(), version-matched to the remotion pin (4.0.541), so the render blocks until each font is ready and fails loudly on a 404. Two options: url: staticFile('fonts/anton-latin-400-normal.woff2'), or import the file from the package: import antonUrl from '@fontsource/anton/files/anton-latin-400-normal.woff2'. The package's exports field allows './files/*.woff2' and Remotion's bundler accepts .woff2 imports, but this combination has not been tested here. Load only the weights in use and the latin subset.
- Add a CI check that reads the 'license' field of every node_modules/@fontsource*/*/package.json and fails unless it is "OFL-1.1" (optionally also "Apache-2.0"). UFL (Ubuntu) fonts and anything else need manual review.
- Add a CI smoke test that renders one still and a short clip with network egress blocked, or with fonts.googleapis.com and fonts.gstatic.com blocked. This proves no font comes from Google at render time.
- OFL fonts need no on-screen or description credit in videos or thumbnails (OFL-FAQ 1.1.2). If font files are committed to a public repo, or otherwise redistributed, keep OFL.txt beside them. Never rename or modify fonts in a way that conflicts with a Reserved Font Name; Anton, Montserrat, Inter and Archivo Black declare none.
- Keep a THIRD_PARTY_ASSETS manifest (JSON) in the repo. For every font record family, version, license, and source URL. For every music or SFX file record track title, artist, license type (YouTube standard vs CC BY 4.0), the exact attribution text, download date, and a screenshot or text copy of the license panel shown at download.
- For CC BY 4.0 Audio Library tracks, the description generator must paste YouTube's attribution text verbatim. Make sure it includes the title, the artist, 'Creative Commons Attribution 4.0', the link https://creativecommons.org/licenses/by/4.0/, and the source link. Under the CC BY 4.0 definitions, music synced to video always counts as Adapted Material, so also add a modification note such as 'Music edited/synchronized for this video'.
- Until YouTube's Audio Library terms are read from support.google.com, treat standard-license Audio Library tracks as YouTube-only. Build the pipeline so each platform gets its own music bed (a YouTube render and a cross-post render for X and TikTok). For non-YouTube cuts, use music licensed for any platform: CC0, CC BY 4.0 with attribution, or self-produced or AI-generated music whose license has been verified separately.
- Keep the music stem separate from the voice-over and SFX stems in the ffmpeg mix. Then the music can be swapped or removed without re-rendering visuals if a Content ID claim or a platform policy issue comes up.
- Re-run this verification after support.google.com (YouTube Help), studio.youtube.com, openfontlicense.org, fontsource.org, fonts.google.com and www.remotion.dev are allowed in the session's network settings. All of them returned 'agent proxy: no rule or network setting allows this host' in this run.

**Open risks**

- The three YouTube Audio Library claims are unverified: monetization, attribution format, and use outside YouTube. support.google.com (and studio.youtube.com) is blocked by this session's network policy, and that host must be allowed in the session's network settings before these can be checked against YouTube Help article 3376882 and the Audio Library terms. The search summaries seen are not primary sources, and third-party guides contradict each other on off-platform use.
- YouTube sets Audio Library licenses per track and can change terms without notice. Content ID can still produce false claims, so keep evidence of the license that applied at download time.
- The 'Adapted Material' rule in CC BY 4.0 (music synced to video) means credits should state the modification. If YouTube's stock attribution string omits this, the credit could be argued to be technically incomplete.
- Remotion docs on the main branch already describe v5.0 behaviour (required weights and subsets), but npm latest is 4.0.546 and the project pins 4.0.541. Pin exact versions, and recheck the docs when upgrading.
- Remotion has no doc page about Fontsource specifically. Importing @fontsource CSS or woff2 files through Remotion's bundler is inferred from two documented facts (CSS imports and .woff2 imports are both supported) and has not been tested in this project.
- Font licenses differ per family even inside Fontsource and Google Fonts (OFL, Apache-2.0, UFL), so check each new family. Some OFL fonts declare Reserved Font Names, which restricts renamed or modified redistributions.
- Not covered by this research: Remotion's own commercial license terms, YouTube monetization and ad-suitability policy for crypto, token or memecoin promotion, and TikTok/X music policies. These may limit monetization regardless of asset licensing and should be checked separately.
- OFL-FAQ text was read from SIL's own GitHub repo copy (silnrsi/font-andika, Version 1.1-update7, November 2023) because openfontlicense.org was blocked. A newer FAQ revision may exist there.
