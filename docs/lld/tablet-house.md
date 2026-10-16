# The Tablet House (game) — design

A small immersive game at `#/tablet`: you are the palace scribe of a real city in the week it falls or holds, and you
decide what goes on the clay. Five days, one tablet, one king who wants smaller dead and bigger victories. At the end
your tablet is set beside the record and beside the chronicle that really survived. The archive's central idea — who
writes history, and how they bend it — made playable. Every fact comes from the record; only the scribe's private life
and choices are invented.

## Player promise
- **Ten minutes, one sitting, replayable.** A daily scenario (same for everyone that day) plus "another city".
- **Immersive:** the city in 3D at dusk (terrain view framed on the city at that year; the city model when available),
  procedural sound (wind, the market, drums, fire, a stylus pressing clay), a tactile clay tablet you press words into.
- **Phone-first**, works on desktop; reduced motion and muted audio respected.
- **Shareable ending:** "I was the scribe of Tivintukhe, AY 402. I wrote 1,000 enemy dead. The record says 167." with a
  card image and a link to `s/tablet.html`.

## The five days (state machine)
Each scenario has the same skeleton; the text comes from the scenario script (agent-written, record-checked), the numbers
from the record.

| Day | Beat | Player acts | Hidden truth |
|---|---|---|---|
| 1 Muster | The levy marches out; the king wants the muster written large. | Write the muster number (true / rounded up / boasted). | `muster.true` (battle size) |
| 2 The field | The battle news arrives, and later the wounded. | Write our dead and theirs; who won. King leans. | `battle.losses`, `battle.winner` |
| 3 The walls | Siege: grain price, rumour, a moral choice (hide the true tally? feed a neighbour? save a document?). | One choice card (2–3 options). | prices, famine/plague overlap |
| 4 The end | Sack (fire, the archive in danger) or treaty (terms read at the gate) or the walls hold. | One choice card + write the terms ("villages of no account"?). | `outcome`, `treaty.terms`, `burnedArchives` |
| 5 The tablet | You compose the final entry from your choices; the king reads it. | Confirm / amend under pressure. | the real chronicle's claims |

Meters: **Favour** (the king's), **Conscience** (truth told), **Household** (your family's safety). Choices move them;
some endings depend on them (rewarded flatterer; dismissed honest scribe; a scribe who hid the true tally in a jar).
Ending screens:
1. Your tablet (rendered clay, your words) beside the record's figures and the real surviving chronicle's words.
2. "How history remembers you": the archaeologist of AY 49xx finds your tablet (condition drawn from the scenario id and
   your choices) and writes one paragraph — honest tablets agree with the record; boasts are caught like the steles are.
3. Score and share.

## Data: `scenarios.json` (engine export, contract type `ScenariosJson`)
Built by `engine/src/export/scenarios.ts` from the record. One entry per playable moment (a siege or sack with a battle
before it, a city with a palace, a defender state with writing at that date), ~30 chosen across five millennia.
```ts
interface Scenario {
  id: string;                    // "sc-<eventId>"
  event: number; year: number;   // the siege/sack event and its year
  city: { id: string; name: string; pop: number; cell: number; port: boolean };          // period name
  state: { id: string; name: string; ruler: { id: string; name: string; sex: 'm'|'f'; age: number }; faith: string;
           gods: { name: string; sex: 'm'|'f'; role: string }[]; coin: string | null; grain: number | null };
  enemy: { id: string; name: string; ruler: { id: string; name: string; sex: 'm'|'f' } };
  medium: string;                // clay tablet / papyrus / paper … at that date
  script: string;                // the script's name
  battle: { id: string; place: string; ours: number; theirs: number; oursLost: number; theirsLost: number;
            won: boolean; commander: { name: string; sex: 'm'|'f'; isKing: boolean } };
  outcome: 'sacked' | 'conquered' | 'treaty' | 'held';
  burnedArchives: boolean;
  treaty: { id: string; ceded: number; tribute: string | null; truce: number | null; text: string | null } | null;
  hardship: { famine: boolean; plague: string | null; drought: boolean; grainBefore: number | null; grainAfter: number | null };
  chronicle: { catalog: string; author: string; year: number; oursLost: number | null; theirsLost: number | null;
               outcomeWords: string | null; quote: string | null } | null;   // the defender side's surviving account
  names: { f: string[]; m: string[] }; // names in use among the city's people at the time (right sex)
  camera: { x: number; y: number; z: number; target: [number, number, number] } | null; // optional 3D framing
}
```
Scripts (`scenario-scripts/<id>.json`, one per scenario, agent-written): for each day, scene paragraphs (40–120 words),
the king's lines, the choice cards with their effects, and the archaeologist's endings. Placeholders like
`{battle.oursLost}` are filled from the scenario, so no figure is ever typed by a writer. A validator checks that every
placeholder resolves and that no digits appear in the prose outside placeholders.

How the export reads the record (`engine/src/export/scenarios.ts`; the contract type carries further fields, never
fewer, each commented there):
- **The moment.** A siege or sack of a state's capital whose cause is a battle of the same war fought that year; the
  besieged is the war's defender ("ours", the scribe's side), with writing at the date, a sovereign alive in the palace
  (not killed in that battle) and a row in the decadal survey. ~30 are picked by drama (city size, battle size, burned
  archives, the defender's surviving chronicle, a surviving treaty text, flagships and documents about it, hardship of
  the year), six per millennium, two sacks, a conquest, a peace, walls that held and a conquest or peace in turn; never
  the same city or war twice, regions and decades spread within each millennium.
- **The ending.** `sacked`: the event is a sack. `conquered`: the war's conquest annexed the defender within two years.
  `treaty`: the war's peace came within two years. `held`: neither (the war went on, or ended later). `treaty` is the
  war's treaty or conquest when it came within two years (also for a sack); `treaty.text` is the surviving treaty
  document as it reads (in the drafter's language, so its names may differ from the scenario's).
- **The chronicle.** The defender's surviving account of the war. `oursLost`/`theirsLost` are what its surviving text
  says of *this* battle (null when it passes over it, as partisan chronicles do with defeats); `warOursLost`/
  `warTheirsLost` its totals for the war; `quote` one verbatim sentence (this battle's tally when it tells it), and
  `outcomeWords` its closing verdict on the war, verbatim after the date. Texts drop link markup and the editors'
  `[AY n]` marks, nothing else.
- **Names** are realized in the defender's language at the date (`state.langId`); `names` are the personal names of
  people of the city's own people (`city.peopleId`) born up to two centuries before. Prices are grams of silver per
  measure of grain (`state.grainCoin` in the coin). `engine/test/scenarios.test.ts` recounts all of it from
  `world.sqlite`. Writers get a fact sheet per scenario: `node engine/src/cli/scenario-sheets.ts` →
  `build/scenarios/<id>.json` (the scenario, every placeholder with its value, the war's battles and the claims of every
  document about them, the city's people and earlier sacks, the sovereign's family, prices around the date, what
  technology existed, guidance).

## Script format
One file per scenario, `scenario-scripts/<id>.json`; `scenario-scripts/sc-18225.json` is the model. Check it with
`node engine/src/debug/scenario-validate.ts <id>|--all` (also run by `npm test` on every script present).
```ts
interface Script {
  scenario: string;                    // the scenario id, = the file name
  title: string;                       // ≤ 12 words
  scribe: { name: string; sex: 'f' | 'm' };  // the player: one name of the scenario as a placeholder, "{names.f.3}"
  days: Day[];                         // exactly five, in order
  endings: Ending[];                   // ≥ 3; the first whose `when` holds wins; the last has `when: {}`
  archaeologist: { true: string; rounded: string; boasted: string; flags?: Record<string, string> };  // 40–140 words each
}
interface Day {
  day: 1 | 2 | 3 | 4 | 5;
  beat: 'muster' | 'field' | 'walls' | 'end' | 'tablet';   // day 1…5 in that order
  scene: string[];                     // 1–3 paragraphs, 40–120 words each
  king: string[];                      // 1–4 of the sovereign's lines, ≤ 40 words each
  tablet?: Slot[];                     // what is pressed into the clay today (below)
  choice?: Choice;
}
interface Slot {
  slot: 'muster' | 'ours' | 'theirs' | 'field' | 'end';
  prompt: string;                      // ≤ 40 words
  options: { pick: 'true' | 'rounded' | 'boasted'; label: string; line: string; effects: Effects }[];  // exactly one of each pick
}
interface Choice { prompt: string; options: { label: string; effects: Effects; consequence: string; flag?: string }[] }  // 2–3 options
type Effects = { favour?: number; conscience?: number; household?: number };  // whole numbers −3…3, at least one ≠ 0
interface Ending {
  id: string; title: string; text: string;                // text 30–150 words
  when: { favour?: [number, number]; conscience?: [number, number]; household?: [number, number]; flag?: string };
}
```
- **Days.** Day 1 carries slot `muster`; day 2 slots `ours`, `theirs` and `field`; day 3 a choice; day 4 a choice and
  slot `end`; day 5 a choice (confirm or amend under the king's eye). Day 4 tells the scenario's real ending.
- **Slots.** The game fills `{value}` in a line from the record and the pick: `true` is the record (`muster` =
  `battle.ours`, `ours` = `battle.oursLost`, `theirs` = `battle.theirsLost`), `rounded` bends it a little in the king's
  favour, `boasted` as a royal chronicle bends it (more men, fewer of ours dead, more of theirs). A `muster`, `ours` or
  `theirs` line has `{value}` exactly once; a `field` or `end` line has none (its words are the claim: who held the
  field; what became of the city).
- **Meters** start at 0; every slot pick and choice adds its effects. `when` bounds are inclusive, within −20…20;
  `flag` holds when a chosen option set it (as `jar`, a true tally buried). The archaeologist's paragraph is chosen by
  the tablet's worst pick (all `true`, else any `boasted`, else `rounded`), or by a set flag in `flags`.
- **Placeholders.** `{path}` names a field of the scenario (`{city.name}`, `{battle.oursLost}`, `{state.gods.0.name}`,
  `{names.f.2}`, `{treaty.towns.1}`, `{chronicle.quote}`…; the fact sheet lists every path with its value) and must
  resolve to text or a number in that scenario. The game also fills `{scribe.name}` anywhere, `{value}` in slot lines,
  and `{tablet.muster}`, `{tablet.ours}`, `{tablet.theirs}`, `{find.year}`, `{find.condition}` in endings and the
  archaeologist. No digit may appear in prose outside a placeholder; figures in words, record names typed by hand and
  a king for a queen draw warnings. A `treaty` or `conquered` ending must name something of `{treaty.…}`.

## Modules (atlas)
- `atlas/src/game/tablet/` — state machine, meters, endings, share text; `TabletView.tsx` (route `#/tablet`,
  `#/tablet/<scenario>`); styles in `atlas/src/styles/tablet.css`.
- `atlas/src/game/tablet/clay.ts` — the tablet: canvas clay with wedge-pressed text, press animation, fire-darkening.
- Scripts reach the browser bundled with the atlas: a lazy `import.meta.glob` over `scenario-scripts/`, one chunk per
  script. A scenario plays once its script is whole; until then it is left out of the daily draw (decision 0028).
- Playthrough: `node atlas/scripts/tablet.ts [--city=sc-…] [--only=desktop|phone] [--reduced] [--picks=…]` plays every
  day on a desktop and a phone, with screenshots, axe, the share card and the share page's redirect.
- `atlas/src/audio/` — procedural WebAudio soundscape (wind, crowd, drums, fire, rain, stylus), off until the player
  taps "Sound on"; volume follows the day's beat.
- Backdrop: reuse the 3D terrain scene (`atlas/src/terrain/`) framed on the city, time of day per beat; the city model
  from `atlas/src/three/city/` when present. Falls back to the 2D map tile at that year.
- Share: `s/tablet.html` (engine share.ts) with its own card.

## Quality bar
Typecheck, tests (`engine/test/scenarios.test.ts` recounts every scenario fact from the database), atlas build, axe a11y,
Playwright playthrough screenshots on desktop and phone; < 16 ms frames on the backdrop; the game works with sound off and
motion reduced.
