# LLD: the errands of days two to five (Runner of the Tablet House)

Draft, 2026-10-17. Day one, the muster, is live (decision 0032). This designs the rest of Pumi's week (`sc-919`), so the game covers the record's whole week from the levy to the treaty. The words are in `streets-scripts/sc-919.json` (errands 2–5 and `reckoning`). `engine/src/debug/streets-validate.ts` checks them, and `engine/test/streets.test.ts` plays the week every way it can go (10,080 weeks). Read [`prfaq.md`](prfaq.md) and [`hld.md`](hld.md) first.

## The week at a glance

| Day | The record | Verb | Route (measured) | Pressure | The choice bends | Roofs |
|---|---|---|---|---|---|---|
| 1, dawn | the levy marches for Rela | deliver | house of tablets → river gate, 203 m | the horn, 50 s | the muster (`muster`: true / rounded / boasted) | not faster (#57) |
| 2, noon | Battle of Rile, 28 Nurnin: lost; 750 and 818 dead | carry news | river gate → palace steps, 186 m | the rumour, 42 s; a crowd in the streets | what the palace hears of the field (`field`, said on arrival) | the only way past the crowd |
| 3, evening | siege; grain 9.25 against 6.05 | find a person | house → the dyer on the wall walk, about 203 m plus a search | moonrise, 70 s (finding the dyer only) | where the roll of the dead goes, so how many dead the city hears (`ours`) | the wall walk |
| 4, night | the sack, 9 Ani (nine days after the battle); the archive burns | rescue, escape | house → your house in the dyers' street, 213 m | the fire, 66 s; soldiers; smoke; a fragile load | what becomes of the house's copies of the week: fire, cistern or road (`archive`) | the safe way, until they burn |
| 5, a month later | Treaty of Himi (12 Vethni): 25 districts, tribute for 29 years, a truce of 10 | hide a copy | the square → wall, temple, trench or nowhere (up to 145 m) | the herald's reading, 40 s; watchers | where your own tablet of the night goes (`end`) | out of the watched square |

All the figures above come from the record by placeholder. The dates and the gaps between them are the export's own event days (see the fact check).

**The thread.** The runner is the younger brother of the Tablet House's scribe (`{names.m.1}`). They live beside the dyer in the dyers' street, inside the postern, where the world already has "Your house" and "The dyer’s house" (`world/civic.ts` `dyersStreet`). The household is the Tablet House script's own, marked `shared` in the script:
- father `{names.m.4}` marches on day one and comes home wounded on day two;
- mother `{names.f.2}` keeps the storeroom with a bronze knife on day four;
- the dyer `{names.m.7}`'s son never comes home;
- the steward `{names.f.0}` keeps the old queen's house.

Each day's choice moves the Tablet House meters (favour, conscience, household) and leaves something in the ground. The reckoning digs it all up.

**Who writes history.** The eyewitness account (fl-354) says its scribe watched from the roof, came down by the back wall with burned hands, and "did not save one tablet. Not one." The game lets the overseer stay on that roof (he is never named as the author, whose name the record does not give), while the runner carries a basket out. The account never mentions him. The verdict says it: "Runners did not sign what they carried."

## Script format (additions to decision 0032's)

Day one is unchanged and stays `errands[0]`. The day-one runtime (`normalizeErrand`) drops errands it cannot play, and the test asserts it still plays day one alone. The week's errands carry a `kind`:

- **`reading`** (day 2). You run to `to`, then say one of a Tablet House slot's three readings (`slot: "field"`, with labels and lines imported). It needs `arrive.intime` and `arrive.late`, each with a `scene` and a line per pick containing `{tablet.line}`, then `arrive.after`.
- **`destination`** (days 3–5). You choose where it goes, from 2–4 `options`. Each option has:
  - `id`, `label`;
  - `pick`: how the day's record line reads afterwards;
  - `effects` and an optional `flag`;
  - `outcome` (a line for the end card);
  - then either `to` (a run to that place, with its own `arrive.intime` and `arrive.late`), or `at` (a spot at the start: `stair` or `cistern`) and/or `carry`, which run to the errand's `to` and share its `arrive` (`scene`, `carried`, `empty`);
  - an optional `find` (a search on the wall walk, with clue barks).

  `record` names the reckoning line the errand fills: `ours`, `archive` or `end`. `end` brings its own `lines` (three readings of the night). They are not the Tablet House's, whose true line has the canal that decision 0031 replaced with the river.
- **`clock`**: `{ name, seconds, warn, measured, applies?, lateEffects?, crowd?: {share, pace}, load?, extra?, roofsPay?, provisional? }`. Its model is checked against the measured runs:
  - `crowd` slows a share of the street route;
  - `load` slows everything while carrying;
  - `extra` is a search allowance;
  - with `roofsPay`, the crowded streets must miss and a roof run must make it;
  - otherwise a run through the streets makes it and a jog draws a warning;
  - `provisional` downgrades the roof rules to warnings until the mechanic exists and the route is re-measured.
- **Also:**
  - `verb`;
  - `mechanics` (keys from the list below);
  - `barks` (`on` a place, an area or an event: `rumour`, `crowd`, `smoke`, `crack`, `caught`, `caughtLoad`);
  - `note` (the content note, with `play` and `skip`), which is required when there are soldiers or fire;
  - day four's `outcome` and `archive`, which must equal the record's (`sacked`, burned).
- **Placeholders.** The scenario's paths, plus:
  - `{place.<key>}` for any place the world has: `tabletHouse`, `riverGate`, `marketGate`, `postern`, `market`, `well`, `palaceGate`, `temple`, `walls`, `dyer`, `home`, and the areas `quarter`, `potters`, `weavers`;
  - `{<person>.name}`;
  - `{tablet.line}` after a choice; `{value}` only in `end.heard`; `{find.year}` only in the reckoning and the last teaser.
- **The record line never moves.** `end.record` holds record placeholders and places only, so it reads the same however the week was played.

The validator also checks:
- one errand a day, in order;
- a name is the same person under the same key all week;
- people shared with the Tablet House script are its characters, and no others;
- each option set holds the record's reading and the king's;
- every find exists for every way a day can go;
- every ending is reached by some week.

## Day two: the field (carry news)

> *The runner from {battle.place} comes in at noon with no sandals and no spear, and the river gate knows before he opens his mouth.*

- **The errand.**
  - `{names.m.5}`, a runner of the levy, gasps out the date and that the king lives, and gives the news to you: his feet are done.
  - A woman on a roof calls "the king is dead" to the next roof, and the whole town pours down the streets toward the gate for news.
  - Run to the palace steps before the rumour.
- **The choice, on arrival.** The steward and the king's young wife (16 in the record; never named, as she is not a placeholder) hear it first, or after the keening has started. You say one of the Tablet House's three `field` readings:
  - the record's: Yida held it;
  - neither held it;
  - the king held it. The boast becomes the new rumour, a victory running down the steps.
- **In time and late.**
  - Late does not fail. It changes the scene (the palace roof keening, "Is he dead?") and costs favour −1.
  - The evening coda brings the carts in at the river gate: your father with a spear-cut, the dyer walking every cart twice.
- **Voices.**
  - the runner: broken, physical;
  - the steward: dry, exact, protective of the old queen's house ("Neither is a word the palace can live in").
- **The clock.** The rumour, 42 s.
  - Measured: river gate → the foot of the palace steps is 186 m of streets, 28.6 s at a run and 52.5 s at a jog. The crow's line over the roofs never arrives: it stalls at the palace platform, as #57 found for day one.
  - The model: 60% of the street route crowded at 0.45 pace gives about 50 s, so the streets miss.
  - **Provisional** until the crowd and a runners' road exist (see "The roofs pay off").

## Day three: the walls (find a person)

> *Every night now the fires of {enemy.name} burn on the flats beyond the east wall.*

- **The setup.**
  - Grain at the weigher's scale costs `{state.grain}` against `{hardship.grainBefore}` in the old queen's day. The figures are the decade's, as the PRFAQ requires; no invented siege price.
  - Your brother has pressed the roll of the dead for several nights (the Tablet House's day three, from his bench). The priestesses want it and the steward forbids it.
  - The dyer, whose son's token never came back, has gone up on the walls. "I pressed it. I cannot carry it too."
- **The choice is where you take the roll.** The honest road is the long one, and the only timed one:

| Option | Destination | Record line `ours` | Effects | What follows |
|---|---|---|---|---|
| Find the dyer | the wall walk above the river gate (the road the levy took); a search | true (the whole count) | conscience +3, favour −2, flag `roll-dyer` | You read him his son's line, then the whole street. He keeps the roll by his lamp, so it burns with the street on day four, bakes and survives. |
| The priestesses of Vinba | the temple, 94 m | rounded (the dead who came home; "the road will sing" the rest) | conscience +1, favour +1 | The roll goes in a jar by the altar, unfired. |
| The steward | the palace steps, 15 m | boasted (the palace's figure stands) | favour +2, conscience −2, household +1 (emmer) | It goes into the soaking trough. |

- **The search.**
  - Clue barks from the weigher (with the price on the pan), a sentry (who watches Yida's fires) and your mother (on your roof).
  - Late, the watch has cleared the walls, and you find him on his own step.
- **The clock.** Moonrise, 70 s, for the dyer only: the measured 29.8 s (run) and 54.5 s (jog) to the river gate, plus 20 s for the stair and the walk. A run makes it, and a jog does not.
- **The end card.** "The city was told of `{value}` dead" against `{battle.oursLost}`.

## Day four: the fall (rescue, escape)

> *The drums stop.*

**Before the night.** A content note, with "Play the night" and "Skip the chases", as the PRFAQ requires.

**On the roof.** On the roof of the house of tablets the archive burns overhead, and the overseer fills one basket from the drying racks: the house's copies of the week. Below, your brother has the king's order about the tallies, which is his choice in the Tablet House and is left to him. "Fire bakes clay. Water unmakes it. I am staying on the roof." The choice is a place:

| Option | Where | Record line `archive` | Effects |
|---|---|---|---|
| Give it to the fire | the burning stair, in the house | rounded: baked hard, broken by the falling roof | conscience +1, favour +1 |
| Drown it | the cistern in the courtyard (world: `civ.tablet.cistern`) | boasted: grey silt | favour +3, conscience −3 ("the king will hear who made it so") |
| Carry it home | over the roofs, with the load | true if it arrives whole; rounded if cracked; nothing if soldiers tip it into the gutter | conscience +2, household −1 |

**The run.** Then the escape home, toward the postern where the enemy came in, through what fl-354 saw:
- in the street of the potters, oil carried off and silver weighed on the merchant's own scale, with laughter;
- young men led toward the river gate with cords on their hands;
- smoke down on the roofs.

**The violence rule.**
- Caught means a fade, a line ("They have taken enough young men tonight"), and the last checkpoint with time lost.
- No blood, no bodies, no weapon in your hands; your parents are adults and survive.

**Arrival.**
- In time: your mother on the storeroom steps with the knife (the Tablet House's image), your father with his leg out straight.
- Late: the roof alight, and your mother singing to Vinba to keep her voice steady.
- If you carried the basket, it sits in the storeroom and bakes when the house burns above it ("Let it bake").

**The coda** is the eyewitness's: one scribe stayed on the roof all night, came down by the back wall with his hands burned, and saved nothing.

**The clock.** The fire takes your street at 66 s.
- Measured: 213 m, 33.1 s run, 60.4 s jog, 51.2 s roofs (26% on roofs).
- At a load of 0.88: streets 37.6 s, roofs 58.2 s, a loaded jog 68.6 s (it misses).
- Provisional until the soldiers and the smoke exist.

## Day five: the tablet (hide a copy)

> *A month after the burning, the great queen's herald reads the peace in the burned square.*

- **The setup.**
  - The terms are read by placeholder: districts, towns, tribute, trade, truce.
  - The king stands with his hands open, as the enemy's dispatch (fl-336) has him come before her.
  - The steward orders every tablet that came out of the fire to the palace, "to be soaked and pressed again."
  - The overseer presses the grain count again on new clay, from memory (fl-354).
  - In your shirt is your own tablet of the night. While the herald reads, nobody watches the lanes.

| Option | Where | Record line `end` | Effects |
|---|---|---|---|
| Hand it in | the steward's table (no run) | boasted: the new archive's "in his mercy gave them peace" | favour +3, conscience −2 |
| The earth of Vinba | the offering pit behind the temple | rounded: the damp leaves the softened version | conscience +1, favour +1 |
| The wall at home | your house: your mother plasters it in | true | conscience +2, household +1, favour −1 |
| The trench | the foundations of the new hall, by the palace gate | true, under the throne | conscience +3, favour −1, flag `throne` |

- **Late** means the reading ended and the steward noticed (favour −1); the scene changes, and the hiding still happens.
- **The clock.** The reading, 40 s. Measured to the farthest place (home): 145 m, 22.3 s run, 40.2 s jog, plus about 4 s for the square's crowd.
- **The coda.** The king hears the new archive's first tablet: the villages were poor ones, given away out of pity. These are the chronicle's words, and the Tablet House king's.

## The reckoning

**The panels.** Same archaeologist and dig year as the Tablet House (`digYear`). One panel each:
1. An intro: "the season that gave us the war tablet of {your brother}".
2. Five finds, one per line.
3. A verdict.
4. An ending.

**The finds.** Each is ≤ 60 words, set beside the record:

| Line | Comes from | Scoring (as the Tablet House: 20 / 10 / 0) |
|---|---|---|
| muster | day one's saved pick; late means the toll-niche tablet by the river gate | true / rounded / boasted |
| field | day two's reading, baked in the archive fire | true / rounded / boasted |
| ours | day three's destination (the dyer's baked roll: `{battle.oursLost}` lines, blue dye in the cracks) | the option's pick |
| archive | day four (the storeroom basket; the fire's shards; cistern silt; or nothing) | delivered 20, cracked or fire 10, cistern or lost 0 |
| end | day five's hiding place | the option's pick |

**The verdict.**
- A score ≥ 80 reads "true", ≥ 40 "rounded", below that "boasted".
- The king's week meets `{chronicle.quote}`.
- An honest week scores 100 and the king's week 0; the test pins both.
- Across all weeks: true 13%, rounded 74%, boasted 13%.

**The endings.** The first that holds wins. Each is reached; the counts are of the 10,080 weeks:

| Ending | When | Weeks |
|---|---|---|
| Under the throne | flag `throne` | 2,880 |
| The king's runner | favour ≥ 7 | 676 |
| Water for the dyers | conscience ≥ 8 and favour ≤ −4 | 456 |
| The week under the floor | the carried basket arrived | 2,472 |
| Read aloud, door by door | the roll went to the dyer | 1,928 |
| A runner of the new house | the fallback | 1,668 |

**Sharing.** The share line reuses the Tablet House's `headline` with the script's `share.intro` ("I ran for the house of tablets of Pumi, AY 332.") and five squares, one per line.

**The reference.** `parseWeek`, `weekPaths`, `reckon` and `weekTexts` are exported from the validator; the runtime ports them.

## New mechanics (implementation sketches on the errand runtime)

Everything hangs off what exists:
- `StreetsGame.onStep({now, moved, feet, grounded})`;
- `frozen` and `input.enabled`, `face`, `teleport`, `drive`;
- `city.layer.route(a, b, w)` (A* on the 1 m grid);
- `city.affordances` (`places`, `ladders`, `waterDepthAt`);
- `layer.civ` (`gates`, `walls`, `tablet.cistern`, `dyers`, `people`);
- `smoke.ts` (`FIRE`, `HEARTH`);
- `sound.ts` (`setBeat`, `cue`, `horn`);
- the levy's merged figurines (`errand/levy.ts`).

Efforts are for one agent, in days.

| Mechanic | Day | Sketch | Effort |
|---|---|---|---|
| **Week engine** | all | Generalise `errand/engine.ts`: `kind` and `options`; phases `brief → choose → (done) → run → arrive → end`, where the choice comes before the run (destination) or after it (reading). Extend `PLACE_KEYS` to `WEEK_PLACES` and fill `{place.<key>}` (port `weekCtx`). Add a week save `pal-streets-week-v1` with per day `{pick or option, late, load}`, checkpoints at each day's start, and "Continue". Add a reckoning view: `clay.ts` for the tablets, `reckon()` for the words. | 3 |
| **Barks** | 2–5 | Place- and event-triggered lines in a polite live region, each said once per run. Place barks fire on entering a place's radius or a quarter's circle (`Quarter` in `layer.ts`). | 0.5 |
| **Crowd** | 2, 5 | A density field on the route grid, seeded along `route(gate, palace)` from the gate inward (`share` of its length), with counterflow figurines merged like the levy and a shader sway. In `stepMove`, cap speed at `lerp(1, pace, density(x, z))` on the ground only; roofs are free. Phones: half the figures. | 2 |
| **Rumour** | 2 | The clock, plus a front that moves along the roof line by `t / seconds`; `rumour` barks as it passes markers; at its end the palace keens (sound: `crowd.panic`). | 0.5 |
| **Search** | 3 | The dyer stands on the wall walk at the walk point nearest `riverGate` (`civ.walls` stairs and feet). Clue barks are `find.clues`. Arrival is within 3 m on the walk (`lift > 2`); late moves him to `dyer`'s door. | 1 |
| **Fragile load** | 4 | `carry`: speed and jump × `load` (0.88). On landing, damage = `max(0, drop − 2.2 m) × 25` per landing, halved after a roll (`counts.mantles` and `land` pose); integrity ≥ 70 means delivered, 1–69 cracked. `caughtLoad` means lost. A basket on the satchel bone (asset), and a HUD basket with tablets that crack. | 1.5 |
| **Fire spreading** | 4 | Each house gets an ignite time `t0 + dist(source) / v + jitter(hash(id))` from two sources, the postern lots (the plan's sack direction) and the palace roof. Burning houses get instanced flame cones and `FIRE` smoke columns (capped at 12 on phones). A burning roof is a no-go: a push-back and a hot bark. `home`'s ignite time is the clock. After the night, swap to the sacked geometry (`burnt.ts`), once. | 3 |
| **Smoke** | 4 | `scene.fog` near and far lerp with fire progress and distance to burning houses; soldiers' sight × 0.5 in smoke. Reduced motion: no flicker. | 0.5 |
| **Pursuers** | 4 (5: watchers) | Soldiers patrol street polylines (`route` between gate, market and potters). Each has a 70° view cone of 18 m (9 m in smoke) with a BVH or ray line of sight, and hears running on roofs within 10 m. Noticed after 1 s, then a chase on the 1 m grid at 0.9 of the runner's run; they never climb. Caught: a fade, a bark, the last checkpoint and +8 s. Skip the chases: no soldiers, panels instead. Day five: static watchers at the square's lane mouths, the same cones. | 3 |
| **Content note and checkpoints** | 4 | The `note` panel before the brief; "Skip the chases" sets a save flag; a checkpoint at the house door, the market and the potters' street. | 0.5 |
| **Runners' road (#57)** | 2 | Lane planks laid on hints along the roof line from the street of the potters toward the palace (`world/houses.ts` `planks()` takes lane hints), plus a ladder up the palace platform's flank. Then re-measure day two. | 1 |
| **Sacked-world places** | 5 | Keep the postern, `dyer` and `home` in the sacked city (issue #60). | 0.5 |

Total: about 17 agent-days, best taken in the HLD's steps 5 and 6. Day two and three's mechanics come first (crowd, rumour, search, barks, week engine); then day four (load, fire, smoke, pursuers, note), which needs the PRFAQ's violence review before it ships.

## The roofs pay off (issue #57)

Day one honestly found the streets faster. The week turns that around without lying about the city:
- **Day two:** the crowd fills the streets and a runners' road of planks crosses the lanes, so only the roofs beat the rumour. The validator enforces this (`roofsPay`) once the provisional flag is lifted, and a re-measured roof run must beat 42 s.
- **Day three:** the dyer is only on the wall walk; the walls are the vertical layer.
- **Day four:** soldiers hold the streets, so the roofs are the safe way, until they burn. The load punishes drops: use ladders.
- **Day five:** the lanes out of the square are watched and the roofs are not; the trench is behind the burned palace wall.

## Fact check

**Method.**
- One read-only pass over `build/world.sqlite` (`node:sqlite`, world `ef5abe84`) and the fact sheet, with each claim checked by query: 28 of 28 hold.
- The event days come from the archive's own `eventDay` (engine run on seed 5):
  - Rile on 28 Nurnin (day 251 of the year);
  - the sack on 9 Ani (day 260, nine days later);
  - the treaty on 12 Vethni (day 291, 31 days after the sack: "a month after the burning").
- The months run Shetku, Shenmum, Tovon, Badu, Orvil, Uref, Ushuth, Ludhuf, Nurnin, Ani, Vethni, Domin.

| Claim (as the game says it) | Source |
|---|---|
| Rile, AY 332: 5,129 of ours against 11,288; 750 and 818 dead; Yida held the field; near Rela | events 918 (`attackerSize`, `defenderLosses`, `winner`); event_parts `near` set:112 |
| The king led it and lives; he is 19; he reigns until AY 392; Magunnufmalin led Yida | event_parts 918; persons 1097 |
| "The old queen": his mother, ruler 310–327, dead before the war | persons and roles 1079 |
| His "young wife", 16 | persons 1223 |
| The great queen, 68 | persons 957 |
| Grain 9.25 g of silver a measure (330s), against 6.05 in "the old queen's day" (320s) | prices, settlement 17, grain |
| The sack by Yida, AY 332; the archive burned | events 919 (`burnedArchives`); event_parts |
| The Treaty of Himi: 25 districts (Virathkanu, Binga among them); tribute 1,089 kg ("36 talents") a year for 29 years; trade; a truce of 10 years; sworn at Pumi by both sovereigns | events 920 terms; event_parts |
| The roll of the dead has `{battle.oursLost}` lines | the Tablet House's own reading (every token not given back = `battle.oursLost`) |
| Vinba of the earth (the priestesses, the offering pit); Eva of fire | deities 15, 18 |
| "Everything comes round again on the wheel" | movements 2 tenets |
| The chronicle's "It cost us 199 men, and them 1,312." (AY 338) | artifacts 3033 (PAL·CH·00074) |
| The river gate and the street of the potters; silver weighed on "our own scales" with laughter; the oil taken; young men "with cords on their hands"; a scribe on the roof, down the back wall with burned hands, who saved not one tablet; the grain count rewritten "on new clay" | artifacts 35692 (PAL·CH·08471, fl-354) |
| The king came before the great queen "with his hands open" | artifacts 35674 (PAL·LT·01721, fl-336) |
| Yida's camp lies east (its capital is east of Pumi) | cells of set:17 and set:0 (the camp's side is the Tablet House script's) |
| The dyers' street burns | the world model: with `?sacked=1`, no unburnt house is left by the postern (140 burnt) |

**Invented, and labelled as such by the HLD's rule** (private life, from the scripts):
- the household;
- the dyer's son;
- the steward's words;
- the overseer on the roof;
- the trench, the pit and the wall niche;
- the barefoot runner;
- the crowd, the rumour and the watch at moonrise.

Day one's caveat stands: nothing in the record says which gate the levy used.

## Open items
- **Re-measure.** Day two's and day four's clocks are `provisional` (validator warnings) until the crowd, the runners' road, the load and the soldiers exist. Measure them with the method of `atlas/scripts/streets-errand.ts` `measure()`; the probe should learn the week's routes.
- **Day five's world.** It needs the sacked city with the dyers' street kept (issue #60).
- **Age, and no child in danger.** The runner's age is never stated; the runner model is a young man, so no child is ever in danger. The king's wife is never named, because her name is not a placeholder of the scenario.
