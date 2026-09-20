# Build With AAI

**An AI development community building useful technology together.**

AAI brings developers, researchers, designers, and testers together to turn ideas into products. Our starting interests are Solana research tools, experimental trading systems, XAUUSD expert advisors, and Telegram utilities. We also want to explore practical ways for AAI to be used to pay for useful services.

This repository is the community's starting point: what we want to build, what exists, what remains uncertain, and where you can help.

## Start here

- **Explore the plan:** [Roadmap](ROADMAP.md)
- **Pick something useful:** [Starter tasks](tasks/STARTER_TASKS.md)
- **Join the work:** [Contributing](CONTRIBUTING.md)
- **Understand the funding intent:** [Founder funding](docs/FUNDING.md)

## Projects

| Project | What we want to build | Current status | First contribution |
| --- | --- | --- | --- |
| [AAI Scan](projects/AAI_SCAN.md) | A Telegram journal showing what changed in a Solana token since your last scan | Private pilot code exists; hosting and live Telegram validation pending | Improve report clarity and document pilot acceptance checks |
| [Solana Trading Lab](projects/SOLANA_TRADING_LAB.md) | A research and paper-trading system, including a jellyfish-inspired model experiment | Idea and research brief | Identify a reproducible model and define comparison baselines |
| [XAUUSD EA Lab](projects/XAUUSD_EA_LAB.md) | Expert advisors for gold with reproducible research and execution controls | Idea and research brief | Specify one strategy and its broker assumptions |
| [Telegram Tools](projects/TELEGRAM_TOOLS.md) | Bots that solve everyday community and developer problems | Idea collection | Propose one small workflow with a clear user benefit |
| [AAI Utility](projects/AAI_UTILITY.md) | AAI as a way to pay for useful products or services | Design exploration | Define a useful service, payment flow, and refund behavior |
| [Launch Research](research/LAUNCH_STUDY.md) | Evidence about launch behavior, liquidity, volatility, and longer-lived projects | Research protocol proposal; no findings established here | Define the sample and outcome measurements |

**Status snapshot: September 20, 2026.** Research ideas are not shipped products. The proposed sequence can change as the community brings evidence and working prototypes.

## Our first working project

AAI Scan has a private Python pilot with **Scan → Watch → Compare**, saved observations, a short timeline, and change alerts. Its 29 offline tests passed, and one live public market-data request succeeded during development. Live Telegram delivery, production hosting, and end-to-end operation still need validation.

The pilot does not execute trades. Its reports distinguish observed data, interpretations, and unknowns. It does not yet verify Pump.fun origin, identify creator trades, or predict runners. The code repository is currently private; this public hub is where research, documentation, and proposals can begin.

## How to help

Choose a [starter task](tasks/STARTER_TASKS.md), open an issue describing your approach, and link a focused pull request when you have something reviewable. Contributions can be research, writing, design, test cases, or code; they do not have to start with a large feature.

Project maintainers review scope and changes. AI-assisted work is welcome when the contributor can explain it, identify its sources, and verify the result. Compensation, token allocation, and repository licensing are separate decisions; this roadmap does not offer them.

We will record progress as evidence and working results become available. No release date, token launch date, trading return, or token-price target is promised by this repository.
