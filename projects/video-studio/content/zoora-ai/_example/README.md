# `_example`: a fictional episode for the publish kit

This is not a real episode. It shows the `episode.json` format that `scripts/publish-kit` reads. Run it from
`projects/video-studio` with:

```sh
node scripts/publish-kit/cli.ts zoora-ai/_example
```

- **Story.** A made-up wallet-drainer scam: a fake airdrop, a fake claim page and one signature. It contains
  no real people, wallets, handles, prices or results.
- **Narration.** `captions.json` holds the narration with generated word timings. There is no audio. It lets
  the kit write SRT and WebVTT files, lint the narration for claims, and check that the scene promoting an offer
  (`s06`) states the affiliate relationship out loud ("the hardware wallet link in the description is an
  affiliate link, so I may earn a commission").
- **Offer.** `hardware-wallet` is a placeholder from `creator-hub/config/offers.example.json`. Until a real,
  active offer exists in `offers.json`, the kit reports `offers-live` as failing. That failure is correct.
- **Rendering.** There is no `storyboard.json`, so `render-plan.sh` stops before rendering anything.
