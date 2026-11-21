# Balance

How Zoora's needs, acts and feelings keep each other in motion. Code is in `src/brain/tick.ts`, `src/brain/emotions.ts` and `src/brain/decide.ts`.

## What was wrong

The brain counted some things per tick and others per minute. At the live 8 second tick this meant:

- **A choice every 8 seconds.** Each one paid its full relief, while needs rose by the minute.
- **An ambient event on about one tick in ten.** That is an event every minute and a half and a storm every eleven minutes.
- **Feelings that ran to the ceiling.** Any steady signal above about 0.17 reached 1.0 and stayed.
- **Boredom that fed itself.** The rule that answers a rut also fired when the rut was boredom.
- **Nothing that sent her to rest.** Energy sat near the floor.

## What changed

| Part | Now |
| --- | --- |
| Acts | One act lasts 3.5 world minutes. She chooses when it ends, or when an event, a new message or the keeper interrupts |
| Events | The sea is rolled for once per 30 world minutes. About five events a day, and a storm every day or two |
| Need pull | The pull of a need grows with its square, so she goes to what is most unmet |
| Feelings | They settle toward what her needs point at over about 20 minutes. A moment adds on top and fades |
| Acts leave feelings | Painting leaves pride, dancing leaves joy, calling out leaves loneliness, and so on. Less when the act is repeated |
| Boredom | One small bump per act for a rut. A rut of boredom adds nothing |
| Energy | Drains more slowly, and a thin pulse pulls her toward rest |

## What a long run shows

Two days at the live 8 second tick, seed 7, last tenth of the run:

- Leading feeling: calm 48%, curiosity 37%, joy 11%, frustration 3%, pride 1%.
- Mean need 0.46. All 17 acts in use. Energy 0.45.

Before these changes the same run gave one feeling on every tick and every need at 1.0.

`tests/balance.test.ts` holds the bounds: needs between 0.15 and 0.85, no feeling above 85%, at least three feelings above 2%.

## Known limits

- A run at one-minute steps comes out needier than a run at the live tick, with curiosity leading. Tune against the live tick.
- Loneliness and frustration are rare. Nothing answers her when she calls out yet, and nothing goes wrong often.
- These numbers are from the model-free brain. With a model choosing, the mix will differ.
- A real run over days is the next check.
