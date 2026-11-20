# Tidal memory

Zoora's own memory. The code is `src/brain/tide.ts`. Nothing in it asks a model or the network.

## How it works

- A moment is laid on the **surface** with the feeling, place, tide and season it happened under.
- How much it matters comes from how strongly she felt and how new the line is. The kind of event does not set it.
- Once a world day, whatever she did not return to sinks one layer: surface, shallows, deep.
- A memory loses its words before it is lost. In the deep it is a fragment of six words at most. Below the deep it is **sediment**, a count of how a place felt.
- Her present feeling lights memories laid under the same feeling or in the same place. A lit memory rises a layer and does not sink that day. A fragment that rises is still a fragment.
- A memory lit on 9 different days hardens into a **pearl**. She holds 12. A thirteenth dissolves the one she has gone longest without returning to.
- A **storm** lifts two fragments from the deep, washes about a third of the sediment away, and leaves the two fragments side by side as a dream in her private pages.
- Text shaped by a visitor or the web is **foreign water**. It is never lit and never becomes a pearl.
- What she remembers of a place leans her next choice toward it or away from it, inside a fixed bound. It does not make the choice.

Caps: 24 surface, 64 shallows, 128 deep, 12 pearls, 12 memories lit a day.

The two older lists (`shortTerm`, `longTerm`) are still written, because the Telegram thought and the goals still read them. They are not the source for recall.

## The simulator

`src/brain/simulate.ts` lives her days with no model, no network and no database. The same seed gives the same life. `tests/tidal.test.ts` runs 20 days and checks the caps, the size of the saved state, and that storms do not take over.

## What the simulator found in the brain as it was

1. **Habits never wore off.** Each act counted for her whole life, so within hours every act did almost nothing, all five needs sat at their ceiling, and curiosity led every tick. Half of each count is now forgotten every 45 world minutes.
2. **Closed wants were kept for good.** After 20 simulated days the saved state was about 2 MB, written on every tick, and it kept growing. Open wants and the latest 24 closed ones are kept now. After 30 days the state is about 75 KB.
3. **The world pressed by the tick, not by the minute.** A faster clock made a louder bowl. It presses by the minute now.
4. **Feed, diary and audit rows were never removed.** `src/db/prune.ts` keeps the latest 20,000 of each, once a day, and counts the rest into `history_days`.

## Not solved here

Her needs are not balanced yet. In a 30 day run four needs sit near zero, quiet sits near its ceiling, and boredom or calm leads most ticks. The cause is in how an act relieves a need: relief is counted per tick while needs rise per minute, and repeating an act costs the same however often she chooses it, so choosing well changes little. Until that is rebuilt her pearls will be made under one or two feelings. That is the next update.
