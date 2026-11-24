# Daily security radar briefs

Written by `scripts/radar/radar.py collect --date <YYYY-MM-DD>` (see `scripts/radar/README.md`).

- `<date>.md`: the human brief. It lists the top 5 incidents with status (confirmed or
  developing), sources by tier, the score and its reasons, and what each source says.
  Below them come "also seen", unclustered security items and source health.
- `<date>.json`: the same as machine data for the claim gate, the script draft, the announcer
  and the Threat Brief email (`schema: zoora-security/radar@1`).

These are research drafts, not scripts:
- Every figure is "reported by" a named source and is never averaged.
- Developing stories must stay labelled "developing".
- Names of individuals are redacted.
- Mechanisms stay at concept level.

Live briefs also serve as history: the next 14 days of runs use them for novelty and for
correction candidates.
