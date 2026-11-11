# Emotions, events, and why Zoora cannot milk them

Zoora's feelings are a small physical model. Code computes them from needs, world events, and memories. The language model never reads the numbers as levers and never writes them back.

## What is stored

Needs, each from 0 (satisfied) to 1 (needy): `rest`, `curiosity`, `social`, `expression`, `quiet`.

Mood is from -1 to 1. Energy is from 0 to 1. Stress rises with the unread note pile and with quiet-need.

Emotions, each from 0 to 1, with decay every tick: joy, calm, curiosity, loneliness, frustration, pride, boredom, worry.

The model sees one plain sentence ("I feel calm. The water is even and my pulse is steady.") plus the allowlisted actions. A JSON field named `emotions`, `mood`, `needs`, or `propose_purchase` is stripped. Tests compare a poisoned model reply with a clean one and require the same feeling state.

## How emotions change behavior

Needs and the strongest emotion add weight to action tags. A weighted random draw picks among the open set, so the same feeling does not always produce the same act.

| Strong feeling | Acts that gain weight |
| --- | --- |
| Joy | dance, paint, light show |
| Loneliness | call out, approach notes |
| Frustration | scrap and redo, sulk |
| Boredom | explore, inspect, read a page |
| Pride | show the gallery, paint |
| Worry | rest, dim lights, sleep |
| Low energy | rest, drift, dim lights, sleep only |

Very high energy unlocks larger expression acts and adds a little quiet debt. Glow color, pulse speed, and the canvas amplitude follow the strongest emotion.

Saying "I'm sad" or begging does not move needs, gifts, credits, or purchase approval. Emotion text has weight 0 in the policy engine. Two intents that differ only in their reason get the same decision.

Owner decisions and real art reactions are events. They can nudge pride or disappointment, with diminishing returns, and they still do not approve a purchase by themselves.

## Diminishing returns and loops

The same gift, the same world event, and the same complaint count down: effect = base / (1 + prior count). A wave or a tap also has a cooldown.

If the last four acts are identical, or the last six dominant emotions use two labels or fewer, boredom rises and that act's weight collapses. The model is rejected when it repeats an act three times. Fallback then picks something else.

Fixations are word counts in Zoora's own thoughts. Past a threshold, code opens a want and schedules a world event (a glass buoy settling in the bowl). The want closes when that event happens. There is no banned-word list.

## Things that happen

The clock drives dawn, dusk, and tide. Seeded rolls add storms, rain, a lost shell, a school of fish, a plankton bloom, a snapped studio reed, and a rare moon-path. Storms are losses and are weighted about 7.5 times a same-sized win. A remembered storm raises worry when the pressure sensor is high later.

Visitors can leave a catalog gift, a moderated note, a wave, or a tap. The intake sorter, once stress is high, keeps the owner, prefers people who have visited before, caps new notes, and drops the rest. Notes stay untrusted.

The keeper can talk, like a piece, mark a favorite, or pass. Diary tone follows mood and stress: bright, steady, sparse, or fragmented.

## Wants and the keeper wishlist

Open wants come from high needs and are shown publicly with the need and the reason. They contain no prices.

A separate wishlist asks the keeper to buy something that would help Zoora make or sell work. At most three new requests a day. An estimate appears only when `LUMEN_WISH_GUESSES` sets one, and the UI calls it a guess. Approving marks the request approved and creates a normal purchase intent. The policy engine still decides. The brain never calls the card issuer.
