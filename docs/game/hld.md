# HLD: *What the Fire Kept*

Draft for review, 2026-10-17. Read [`prfaq.md`](prfaq.md) first. This document sets out the architecture, systems, platform strategy, content pipeline and scope ladder. It records no decisions: the candidates are listed at the end, and the record queries behind every figure are in the appendix.

**In short.**
- **The week compiler** reads the frozen record (`world.sqlite`, seed 5). It emits one runtime-neutral **week pack** per layer: the city plan at that year, the cast, prices, documents, phrases, errands and the rules of survival.
- **One runtime plays the packs:** three.js WebGPU or Godot 4, chosen by the bake-off.
  - **The loop:** dig, then week, then register.
  - **The shadow archive:** the player's documents live in the save file. It overlays the record and never writes to it.
- **Two repos:** the public repo keeps the archive and the free web games; a new private repo holds the paid game.
- **Content comes mostly from local pipelines,** each behind a validator: kiln, ComfyUI, ACE-Step, gpt-oss-120b. Claude writes systems code, each week's key scenes, and audits.

```
world.sqlite (frozen canon) ─┐     engine/src/lang (canon)    flagships, Tales (fl-354, fl-1003 …)
                             ▼              ▼                          ▼
           week compiler (Node/TS, private repo; reads the public engine and exports read-only)
           ├─ city.json      plan at the year: lots, roads, walls, river, places, sack direction, roofs by age
           ├─ cast.json      record persons + invented roles; the city's names; day schedules
           ├─ economy.json   16 goods at Himi for the decade; coin weight; weight standard
           ├─ documents.json archive documents present at that place and date (text, catalogue, medium)
           ├─ phrases.json   clauses → normalized, IPA, gloss, per speaker language at the date
           ├─ errands.json   generated drafts → validated → written (placeholders only)
           └─ survival.json  the medium rules for this era (fire, water, cellar, copies)
                             ▼                         + kiln asset manifests (glTF, KTX2), audio
       runtime (three.js WebGPU | Godot 4) ── dig ⇄ week ⇄ register ── save (shadow archive)
                             ▼
                 cards, plates, clips ──▶ links into the free archive (GitHub Pages)
```

## 1. Where the game lives

| | Public repo `civilization` (MIT) | Private repo (new) |
|---|---|---|
| Holds | simulation, language, archive, checker, atlas, The Tablet House, the free browser week | week compiler, scripts, kit recipes and assets, score, voices, native runtime, store builds |
| Touches the record? | only through `engine/src/export/contract.ts`, recounted by tests | never; reads exports and `world.sqlite` read-only |

**What the game needs from the public export.** None of these changes the simulation or the language engine.
1. **A week for any sack.** `scenarios.ts` picks one sack per city, so Himi has only `sc-919`. The game needs the same shape (battle, ending, treaty, hardship, chronicle, names) for all sixteen of Himi's sacks: a `sackWeek(eventId)` export.
2. **About 60 names per sex** per city and date. There are 10 today, an item the streets HLD already lists.
3. **Documents by place and date,** with text, catalogue number, medium and finder: the 163 written at Himi, and the 114 finds of PAL·EX·00002.
4. **Phrase realization.** `realize` is called at build time over a fixed phrase list, per language and year. Any new concept goes in on its own RNG fork, and `engine/test/canon.test.ts` must still pass unchanged.

## 2. Structure and state

- **The campaign is a list of layers:** seven full weeks, seven short layers and the epilogue (the PRFAQ's table).
  - The dig opens them with a **sounding**: a narrow trench through every stratum, the way an excavation finds its sequence before opening each layer. The report itself reaches "the foundation of the city, c. 245 before AY 0".
  - So the player meets the bottom first and plays upward in time, which keeps cause before effect.
- **A week is a pure state machine,** like `game/tablet/engine.ts` and `streets/errand/engine.ts`.
  - **State:** day, errand and step, carried items, the Tablet House meters (Favour, Conscience, Household), flags and the clock.
  - **No state can move the record's ending, dates or figures.** A test checks this on every path.
- **The dig is a second state machine:** stratum, finds sieved and read, register entries, and checks in threes.
- **Save:** one versioned profile of up to 256 KB, holding progress, the shadow archive, the register and settings.
  - Native builds sync through Steam Cloud or iCloud; the web keeps its save in `localStorage`, inside try/catch.
  - No server and no account.

## 3. The shadow archive: choices that bend chronicles

This is the system no other game has. It must be deterministic, explainable and checkable.

**Writes.** Each week offers 3–6 **pressings**:
- the Tablet House slots: true, rounded or the king's figure;
- free documents: a tally, a letter, a list of names.

Each becomes a `ShadowDoc`:
- author role and date;
- medium;
- claims, as `{event, field, value, reading}`;
- location and fate.

**Fates by medium.** These are game rules, stated in the UI:

| Medium (era) | Fire | Water or cistern | Cellar | Carried out | Copies |
|---|---|---|---|---|---|
| Unfired clay (Book I) | baked hard; may crack | dissolves | survives dry; damp takes lines | survives with the carrier | by hand |
| Parchment (3166) | burns | survives; ink runs | survives | survives | by hand, slowly |
| Paper (3383) | burns | pulps | survives dry | survives | several |
| Newsprint, typescript (Book III) | burns | pulps | survives | survives | many; carbons |

The flip is the point: in Book I fire keeps, and from Book II on it destroys. The title's answer changes by era.

**Reading forward.** Each later week has a **readable past**:
- the record's documents dated earlier, whose survival the archive already models;
- the player's surviving `ShadowDoc`s.

Lines that cite the past use placeholders such as `{past.evt:918.oursLost}`. They resolve by one rule: **the oldest surviving account in the speaker's reach** (the same place, in a language the speaker can read). Ties go to the sealed copy, then the royal one.

Example: the runner's tablet is dated AY 332 and the eyewitness account (fl-354) AY 333. If the runner's tablet survives in the house, the AY 855 apprentice quotes it, and if it boasts, the city of 855 believes the boast.

**The register.** At each stratum, the dig turns up whatever of yours survived there (in the ash, the cistern silt or the cellar), beside the record's own finds.
- **The entry:** you record date, author and reading, and judge whether it is true.
- **The score** is the Tablet House's: 20 points per true line that reaches AY 4925, 10 per rounded line, none for the king's.
- **The register's own accuracy** is scored too.

**Lineage.** Every claim keeps its copy edges, so one figure's path can be drawn as a card: from the clay of AY 332, through a copy in AY 855, to the register of AY 4925.

**The ending.** Nambili's report is rendered from your finds by a copy of the excavation-report generator in the private repo; the public generator is never reworded. It is set beside the real PAL·EX·00002. Then comes the epilogue: in AY 4951 the archive burns again, and you choose which catalogued finds to carry out.

## 4. Systems

### 4.1 Traversal per era

The city model (0024) already draws its ages, flat mud-brick and later gabled roofs. The streets layer (0031) derives ladders, planks and a traversal graph from the plan. So each new roof type is a new edge type in that graph, not a new game.

| Era | Verbs added | From the record | Notes |
|---|---|---|---|
| Bronze (332, 855, 1858) | roofs, ladders, planks, wading | flat roofs; the river Nudhnavbu; 183 ladders; 223 of 226 roofs reachable (0031) | built to step 3; steps 4–8 remain |
| Classical (3166) | pitched tile roofs, ridge runs, cellars, horses | a horse cost 321 g at Himi in the 3160s; cavalry is on the tech tree from AY 2050 | sloped traversal is the first new controller work |
| Medieval (3383) | boats on the river, wall walks | the river through the town; 34,530 besiegers | boats as timed routes, not a sailing sim |
| Industrial (4821, 4918) | trains, crowds as terrain | Divigvivinge's railway from AY 4901 and telegraph from 4909 | trains you can jump on a timetable; the telegraph errand: a message that outruns you |

### 4.2 Crowds and NPCs

- **Three tiers:**
  - **Hero NPCs** (6–12 per week), skinned, with faces and hair cards.
  - **Named townspeople** (up to 60), with day schedules.
  - **An instanced ambient crowd** with a shader walk. The levy in decision 0032 already does this: 55 figures in 6 draw calls on a phone.
- **Names:**
  - **Record people** with pages: Panshelon, Vanavmanen, Medhelonen II, Dulomin.
  - **Townspeople:** named from the city's own people at that date.
  - **Invented roles:** marked as invented.
- **Schedules** follow the week's beats: muster, field, walls, end, aftermath.
- **Scale is compressed, and the game says so.** Himi grows from 20,817 people (AY 300) to 448,764 (AY 4800). The model draws about one building per 70 people (0024), and crowds draw one walker per N people by device. Each hero district is a corridor of the week's routes: 23 houses of 295 in Pumi (0034).

### 4.3 Economy on the record's prices

Himi has 5,124 price rows: 16 goods, by decade, from AY 20 to AY 4990.

| Good at Himi | 330s | 850s | 3160s | 4820s |
|---|---|---|---|---|
| Grain (measure) | 9.25 g | 14.47 g | 13.02 g | 11.17 g |
| A horse | 257 g | 328 g | 321 g | 1,116 g |
| Coal (ton) | — | — | — | 169 g |

- **Uses:**
  - weighing silver, with coin weights from `currencies.history`, so debasement shows;
  - feeding a household or a neighbour;
  - hiring a horse or a boat;
  - bribes.
- **No invented siege prices.**
  - The weigher asks the decade's price; scarcity is queues, rations and empty stalls.
  - A price the game invents (the postern at night) is labelled as the game's.
- **This is not a trading sim.** A week is too short for one.

### 4.4 Dialogue in the period's languages, with glosses

Conversations are in English, which acts as the translation. The original language appears in four places:
1. **Barks and set phrases:** greetings, prices, warnings, blessings and street cries. Each is a clause over the engine's 373 concepts, realized in the speaker's language at the date as spelling, IPA and a Leipzig gloss.
2. **Inscriptions and signs** in the period's script. A tap shows the transliteration, gloss and translation, as the archive's reader does.
3. **Names.** The city and its enemy are spelled as the speaker's language has them at that date.
4. **A word journal.** It keeps every word heard, with its form in each layer and the dated sound laws between them, as the Word Machine shows.

**Voices** are synthesized locally from IPA; the spike is in `~/projects/offshoots/2026-10-spoken-languages/`. If no local voice is good enough, barks stay as text.

**The languages at 1.0:**
- Bibbu (332, 855);
- Nenan (1858);
- Nekhko (3166, 3383, 4918);
- Birirli (4821);
- Khubunji, the excavator's language, at the dig.

### 4.5 Combat: deliberately none

The player never holds a weapon.
- **Capture** fades to a line and a cost: a basket lost, or a night in a cell.
- **Each week resumes** at the errand's checkpoint, as in the streets PRFAQ.
- **What it saves:** combat AI and weapon animation sets, the budget that most action games spend first. That budget goes into the city instead.

### 4.6 Stealth

- **Perception,** as in the streets HLD: view cones, line of sight, and hearing (running on roofs, a dropped jar).
- **Light:** night, fire, and lamps by era.
- **Disguise:** the record's arms and colours (`heraldry.ts`) dress each side, so the enemy's sash is a disguise.
- **Curfews and patrols** follow the week. Day four empties the streets, and the sack moves in the plan's direction.
- **Cover:** crowds, in the Industrial weeks.

### 4.7 Discovery of real documents

- **Placement.** Each document present at the date and place goes where its genre lives:
  - steles at the temple;
  - treaties in the palace;
  - ledgers in a merchant house;
  - newspapers in the street (*The Pimi Courier*, AY 4917).

  A week holds 5–25 of them, and none appears before its date.
- **Reading is play.**
  - A muster roll says where the levy forms.
  - A ledger says who hoards salt.
  - The edict of AY 3158 says which books will be searched for.

  Each placed document declares the facts it unlocks.
- **The dig's collection** is the report's 114 inscribed finds. Each opens its archive page.

### 4.8 Photo and chronicle modes

- **Photo mode:** a free camera within the hero district, with period plates as filters: relief and fresco, mosaic, woodcut, engraving, photograph.
- **Cards,** drawn in-engine at 1200×630 and 1080×1920, each linking to the record's page:
  - the week's most bent figure against the record's;
  - the lineage card;
  - the register's score.
- **Clips:** 15-second replays. ReplayKit on iOS and Steam's recording on Steam; canvas capture on the web.

## 5. Platforms and engines

**The decision is open,** pending the bake-off of Godot 4.7.2 against three.js WebGPU in `~/projects/offshoots/2026-10-engine-bakeoff/`. The free browser week stays on three.js regardless: it exists, it is the funnel, and it is what decisions 0030–0034 built.

| | three.js WebGPU (web, wrapped for stores) | Godot 4 (native) | Unreal 5 (native) |
|---|---|---|---|
| Reach | a link | stores; web export is WebGL2 (compatibility renderer) only | stores; no web |
| iOS | a WKWebView wrapper. WebGPU is reported on by default in iOS 26 WKWebView, with GPU process crashes reported on an iPhone 15 under 26.4. | native Xcode project; Metal | native; heavy |
| Look | measured: realism at 9.2 ms a frame on the M5 Max (lookdev) | unmeasured; this is what the bake-off checks | highest (Nanite, Lumen, MetaHuman) |
| Large-game tooling | none built in | editor, animation trees, navigation, Jolt physics | everything, including PCG, World Partition and Mass crowds |
| Agent fit | best: TypeScript, as this codebase is | good: text scenes and GDScript diff cleanly | poor: binary Blueprints; C++ compile cycles |
| Cost | none | none (MIT) | 5% above $1M gross; an Epic account |

**What the bake-off should report,** all on the same Pumi district and kit:

| Criterion | "Good enough" |
|---|---|
| GPU time for the realism look, M5 Max, 1440p | ≤ 10 ms |
| A real iPhone 13 class on the phone tier | 30 fps locked through a 30-minute soak |
| 250 crowd agents plus 10 skinned heroes | within those budgets |
| Cold start to the first step | ≤ 8 s (app) / ≤ 10 s on 4G (web) |
| The hero with a face and hair cards | your eye, side by side |
| Agent speed on "ladder climb plus errand" from a spec | wall-clock time and review rounds |
| Builds | iOS device, notarized macOS, Windows, Steam Deck, web |

**Leaning, with its conditions:**
1. **Web for the front door,** whatever the result.
2. **Godot 4 for the paid game if** it roughly matches the lookdev image within budget, and agents ship features in it in no more than twice their three.js time. It gives native iOS, macOS, Windows and Linux builds from one MIT project, text files agents can diff, and an editor to dress districts in.
3. **Otherwise three.js for the paid game too.**
   - On Steam it ships through Tauri or Electron. Vampire Survivors shipped on Steam as a JavaScript game before porting.
   - On iOS it ships through Capacitor, once real iPhones hold WKWebView WebGPU through a 30-minute soak.
4. **Unreal only if** the business turns PC-first and photoreal. It brings MetaHuman faces and hair, at the cost of agent speed and the phone. Epic's 2025 change reportedly allows MetaHumans outside Unreal; check the current EULA before relying on it.

**Keeping the choice reversible.**
- **Packs are plain files:** JSON plus glTF, KTX2 and audio.
- **Logic is small state machines.** If the runtime is not TypeScript, they are ported once and checked against **golden transcripts**:
  - the Node suite plays every path of every week and writes `inputs → states → outputs`;
  - the runtime must replay them exactly, as `tablet.test.ts` already does for 196,830 games.
- **The validators stay in Node.**

**The path to iOS, macOS and PC:**
1. **Install Xcode** (this needs your Apple ID) and build to your own iPhone; a free profile lasts 7 days.
2. **Join the Developer Program** ($99 a year) for TestFlight, review and macOS notarization.
3. **Steam Direct** ($100) for Windows, Mac and the Deck. This needs a Windows test machine, or Proton on a Deck for a first pass.
4. **One universal App Store purchase.** Later books download on demand (Background Assets), so the first download stays under 1 GB.

| Device | Frame rate | Memory | First download |
|---|---|---|---|
| iPhone 13–15 | 30 fps locked | ≤ 1.5 GB | ≤ 1 GB |
| iPhone 15 Pro+, M-series iPad | 60 fps | ≤ 2.5 GB | ≤ 1 GB |
| Mac M1 | 60 fps at 1080p | ≤ 4 GB | ≤ 4 GB |
| Steam Deck | 30–40 fps | ≤ 6 GB | ≤ 8 GB |
| Free web week, phone | decision 0033's tiers | as there | ≤ 4 s to the first step on 4G (13.7 s today, 0031) |

## 6. Content at scale: agents and local models

**The rule:** local first, everything behind a validator, and Claude where judgement or hard code is needed.

| Content | Pipeline (local unless noted) | Validator | Claude's part |
|---|---|---|---|
| City kits per era | `~/projects/kiln` recipes, built in headless Blender, exported as glTF with KTX2 and LODs; gpt-oss-120b drafts the recipes | kiln QA: budgets, contact sheets, the three.js harness; your eye | one generator set per era; reviewing the sheets |
| Characters | MakeHuman (CC0) bodies; kiln hair and beard cards and textiles; UAL and Mesh2Motion clips retargeted in Blender | rig and budget checks; turntables | the pipeline code, once |
| Textures, decals, plates | FLUX.1 schnell (Apache-2.0) in ComfyUI; Wan 2.2 for plates (0029); Poly Haven CC0 | seams; OCR to reject lettering; your eye | none |
| Score | ACE-Step 1.5 XL in ComfyUI, with its licence checked before release; the procedural soundscape | loudness and clipping (`npm run sound`); your ear | none |
| Voices | IPA to TTS (the spike) | IPA round-trip; your ear | none |
| Errands | the record-driven generator (below); lines drafted by gpt-oss-120b | `streets-validate.ts`: placeholders only, no digits, real places and people, horns from measured runs | the 3–5 key scenes of each week, written from a fact sheet and fact-checked, as the flagships were |
| Bulk lines | gpt-oss-120b in LM Studio, in batches | the same rules, plus an anachronism lint against tech dates (no telegraph before AY 4909 in Divigvivinge), length and tone | audits a 5% sample and every warning |
| QA | bots on every path; route bots; frame, memory and soak probes | the thresholds in each LLD | reads summaries, not logs |
| Systems code | — | tests | architecture, LLDs, most of the code |

**The record-driven errand generator.** The input is a layer: the sack and the events around it, the plan's places, the cast, the documents and the prices. Each archetype fires on something the record holds:

| Archetype | Fires on |
|---|---|
| The muster | a battle before the siege |
| News and the wounded | that battle's losses |
| The grain queue | a price rise over the last decade, a famine or a drought |
| The sickness | a plague within five years (the Black Ague, AY 1853) |
| The hidden books | a decree or a persecution (the edict of AY 3158) |
| The terms | a treaty |
| The fire | a sack with `burnedArchives` |

**Each archetype fixes:**
- the giver;
- where from and where to;
- a deadline measured by bots, as decision 0032 set the horn;
- a choice, either a reading or a destination;
- the facts revealed, as placeholders.

**Then the lines:** gpt-oss-120b writes them, the validator checks them, and you curate. About 60% of a week's errands can come from archetypes; the rest are written.

**Claude's budget (estimates):**
- **Sessions:** 30–50 for the slice, 120–200 for Chapter 1, and 300–500 more for 1.0.
- **Words:** about 15–25% of the total, all in key scenes.
- **Assets:** none. No textures, music or voices.

## 7. The scope ladder

Effort assumes you as director and reviewer, agents for code, and local models for bulk content. The streets pace (steps 1–3 in one day, 7,600 lines) is real for code. Content, taste and polish dominate these estimates.

| | **Vertical slice: Pumi, AY 332, polished** | **Chapter 1: three weeks** | **1.0** |
|---|---|---|---|
| Layers | 332, plus a 10-minute dig prologue and the register | 332, 855, 3166, with three strata of the dig | 7 full weeks, 7 short layers, the epilogue |
| What it proves | the loop is fun; the look and the faces hold; outsiders finish | propagation (855 reads 332); a new era kit with sloped roofs (3166) | the whole tell; four era kits; trains and boats |
| Errands | ~12 | ~40 | ~110 |
| Kit pieces | 93 now, ~150 | + ~200 Classical | ~700–900 |
| Characters | 1 hero, 6 heroes with faces, 8 crowd bodies × 3 costumes | ~18 heroes, ~180 named | ~60 heroes, ~600 named; crowds of 250 (phone) and 1,000 (desktop) |
| Clips / texture sets | ~40 / ~25 | ~80 / ~45 | ~200 / ~120 |
| Placed documents | 5 (PAL·CH·08462, 08471, 00074, 00071; the queen's dispatch) | ~25 | ~120, plus 114 finds |
| Score / voiced barks | ~20 min / ~80 | ~60 min / ~300 | ~3 h / ~1,500 |
| Play time | 40–60 min | 8–12 h | 25–40 h; ~60 complete |
| Calendar | 6–10 weeks | 4–6 months more (+2–4 weeks if porting) | 12–20 months more |
| Your hours | 60–100 | 200–300 | 600–900 |
| Claude | 30–50 sessions: days 2–5, the night's stealth, crowds, the prologue, the register, cards | 120–200: shadow archive, dig hub, sloped traversal, horses, port or wrapper | 300–500: boats, trains, crowds at scale, the epilogue, store builds |
| Local | all textures, music, voice; drafts; bots | ≥ 80% of words; all assets | the same |
| Paid help (optional) | — | character artist ($3–10k); 20–50 playtesters | animation cleanup; QA; a trailer editor |
| Ships as | free in the browser, and as the demo | a Steam page and Next Fest demo; optional Early Access | Steam and App Store at $19.99 |
| Exit criteria | the PRFAQ's playtest thresholds; budgets on a real iPhone 12–13 and Galaxy A54; a 90 s trailer | 10k wishlists; demo median ≥ 45 min; 5 of 8 testers can explain the propagation unprompted | the PRFAQ's planning case |
| Kill or reshape if | under 40% of outsiders finish | under 3k wishlists after Next Fest: sell Chapter 1 alone and stop | — |

Chapter 1 takes 3166 rather than 1858 on purpose. It retires the hardest new risk, the first new era kit, before 1.0's months begin. If the Classical kit slips, the fallback is 1858: the same Bronze kit, a burned archive and a plague year.

## 8. Risks

| # | Risk | Why it is real | How it is retired | When |
|---|---|---|---|---|
| 1 | **Scope** | 20–60 hours of 3D with one director | every rung ships; kill criteria; one hero district per week; short layers on the Tablet House engine | every rung |
| 2 | **The loop thins** | fixed endings; carry-choose-arrive repeats | outside playtests from the slice; a verb per era; reading as play; consequences a layer later | slice, Ch. 1 |
| 3 | **Wrong engine, or web can't carry it** | months lost to a port; WKWebView WebGPU unproven | bake-off numbers; neutral packs; golden transcripts | now |
| 4 | **Local text is bland or wrong** | a 120B model invents names and figures | validators reject typed figures and unknown names; anachronism lint; Claude on key scenes; audits | slice |
| 5 | **Faces and hair break the look** | lookdev calls characters "the biggest gap left" | slightly stylized faces; a third-person camera; a contractor for heroes | slice |
| 6 | **Canon breaks** | a language or simulation change renames the world | exports only; new concepts on their own fork; `canon.test.ts`; a world fingerprint in each pack | always |
| 7 | **Niche reach** | Pentiment, Pathologic 2 | free front door; cards and clips; low costs; measure from the slice | slice on |
| 8 | **Phones run hot** | crowds, fire and shadows for 30 minutes | soaks on real devices at every rung; crowd caps; a 30 fps lock | slice, Ch. 1 |
| 9 | **Licence contamination** | Mixamo, non-commercial weights (MusicGen), MetaHuman terms | CC0, MIT or Apache inputs only; kiln manifests | always |
| 10 | **Sensitivity** | sixteen sacks, plunder, captives | the streets PRFAQ's rules; content notes; skippable chases; your review of every night | every week |
| 11 | **Your time** | one reviewer for everything | a review queue of contact sheets and summaries; batched calls; agents never wait on you | always |

## 9. Decisions

**Yours, when back:**
1. **An Apple ID to install Xcode,** for any iOS build on any engine.
2. **The engine,** after the bake-off. An Epic account is needed only if Unreal is chosen.
3. **The business model:**
   - premium with a free first week, Early Access, or Apple Arcade;
   - the private-repo boundary;
   - privacy-respecting play counts.

**Decision candidates:**
- the game itself: one city through its layers, framed by the dig of AY 4925, and the working title;
- the shadow archive's rules;
- no combat;
- two repos;
- the export additions;
- week packs and golden transcripts;
- the content pipelines and their validators;
- Chapter 1's three layers.

**LLDs to write next:**
- the week compiler and its pack format;
- the shadow archive and the register;
- the dig;
- traversal by era;
- crowds and schedules;
- language and voice;
- the errand generator;
- cards and clips;
- store builds.

## Appendix: checking the claims

Run these against `build/world.sqlite` (seed 5).

```sql
-- Himi (set:17): founded, peak, its sixteen sacks, and which burned the archive
SELECT founded, peak_pop, json_array_length(sacks) FROM settlements WHERE id = 17;       -- -245, 1578913, 16
SELECT id, year, json_extract(data,'$.burnedArchives') FROM events
 WHERE id IN (SELECT value FROM settlements, json_each(sacks) WHERE settlements.id = 17) ORDER BY year;
-- burned: 332, 1858, 3166, 3234, 4918, 4951

-- Events at Himi by kind (108 battles, 24 treaties, 22 sieges, 16 sacks, 15 houses, 8 plagues, 4 conquests)
SELECT e.sub, count(*) FROM events e JOIN event_parts p ON p.event = e.id
 WHERE p.ref = 'set:17' GROUP BY e.sub ORDER BY 2 DESC;

-- The battle before each full week's sack: sizes, losses, winner
SELECT id, year, data FROM events WHERE id IN (918, 4360, 14558, 28999, 31431, 46579, 47650, 48007);

-- The dig (Nambili, per:47294, born AY 4874) and the documents written at Himi (163)
SELECT title, body FROM artifacts WHERE catalog = 'PAL·EX·00002';
SELECT count(*) FROM artifacts WHERE settlement = 17;

-- One name across 4,600 years: Duvekopuvinga/Divigvivinge (220); Yida/Yeda/Yidha/Yidhe (228)
SELECT id, name_id FROM polities WHERE id IN (26, 1961, 25, 165, 439, 1324, 1959);

-- Prices at Himi in grams of silver (good 0 grain, 8 horses, 12 coal)
SELECT year, good, price FROM prices WHERE settlement = 17 AND year IN (330, 850, 3160, 4820) AND good IN (0, 8, 12);

-- Census by century; the defenders' eras (0 Bronze, 2 Classical, 3 Medieval, 5 Industrial)
SELECT year, pop FROM settlement_pop WHERE settlement = 17;
SELECT polity, year, era FROM polity_years
 WHERE (polity, year) IN (VALUES (588,1850),(1141,3160),(1336,3380),(1905,4820),(1961,4910));

-- Scale for sequels: cities sacked at least once (247); excavation reports (311)
SELECT count(DISTINCT p.ref) FROM event_parts p JOIN events e ON e.id = p.event
 WHERE e.sub = 'sack' AND p.role = 'settlement';
SELECT count(*) FROM artifacts WHERE sub = 'excavation';
```

- **Rulers at each date:** `roles` where `role = 'ruler'`.
- **Languages:** `cultures.lang` for each state's culture (14 Bibbu, 59 Nenan, 67 Nekhko, 105 Birirli, 68 Khubunji).
- **Tech dates:** `polities.techs` (Divigvivinge: railway, tech 23, from AY 4901; telegraph, 24, from 4909).
- **Flagships:** fl-354 (*The Burning of the House of Tablets at Pumi*, AY 333) and fl-1003 (*Pour Water for the Tablets*, set in AY 855).
- **The Tablet House scenarios:** `atlas/public/data/scenarios.json`; `sc-919` is Pumi.
