# PRFAQ: *What the Fire Kept*, the Palimpsest game

Draft for review, 2026-10-17. This is the first step of PRFAQ → HLD → LLD → code for a full game. The architecture is in [`hld.md`](hld.md). The game grows out of *The Tablet House* (decision 0028) and *Runner of the Tablet House* (decisions 0030–0034, [`docs/streets/`](../streets/)). Every record figure here can be checked in `world.sqlite`. The queries are in the HLD's appendix.

**The concept in five lines.**
1. **One city, Himi, across 4,600 years.** It was sacked sixteen times between AY 332 and AY 4951, and its archive burned in six of those sacks.
2. **The frame is already in the archive.** Himi was excavated in AY 4925 (PAL·EX·00002). The dig found fourteen destruction layers and calls the lower ones "not yet fully excavated". You are the dig's finds registrar, and you finish it.
3. **Each layer opens into a crisis week that you live at street level,** as someone who was there: a runner, a counter of tablets, a keeper of banned books, a printer's boy.
4. **You cannot change what happened. You decide what survives:** what gets written, and what goes to the fire, the cistern, the cellar or the road.
5. **What you leave in one layer is found in the next.** In AY 4925 you catalogue it, and your register is set beside the record.

## Press release

**What the Fire Kept: sixteen sacks of one city, 4,600 years apart, and you decide what the ground keeps.**

*Palimpsest's first full game, for Mac, PC and iPhone. Its first week is free in the browser.*

It is AY 4925, and the archaeologist Nambili is digging the mound of Himi. Under the modern town his trench cuts through fourteen layers of ash and fallen wall. You are his finds registrar. You were about ten when the most recent of those layers was laid down.

**Each layer is a week.** Brush the ash from a tablet in the trench and you are on the roof of the house of tablets at Pumi, AY 332. The levy is marching for Rela, and a basket of clay tokens is on your back.
- **The record decides how the week ends:**
  - the Battle of Rile, lost on the 28th day of Nurnin (5,129 men against 11,288; 750 and 818 dead);
  - the enemy inside the walls on the night of the 9th of Ani;
  - the house of tablets burned;
  - the Treaty of Himi.
- **You decide what survives it.** Fire bakes unfired clay hard, and water unmakes it. The tablets you carry over the roofs, the counts you press into them and the ones you let burn become what the next layer can read.

**Five hundred years later,** in AY 855, the same house of tablets watches the same river gate. Its counter, Padiyyiviyath, has her grandson carry water jars up to the roof, because the first thing every apprentice learns to read is the tablet of the burning. If you pressed the king's figure into that tablet, the king's figure is what she reads.

**Higher up the trench, the city changes:**
- **AY 3166, parchment.** Eight years earlier an edict ruled that a banned faith "shall not assemble, nor teach, nor keep their books". The city held about 137,700 people at the AY 3100 census.
- **AY 4918, newsprint and railways.** 42,028 defenders face 718,494. The war is between the Kingdom of Divigvivinge and the Yidhe Empire, which are Duvekopuvinga and Yida, the same two names that fought in AY 332, after 4,600 years of sound change.

**Everything comes from the record:**
- **The people:** the kings and queens and their ages.
- **The economy:** the price of grain or a horse that decade.
- **The faith:** the gods and the edicts.
- **The archive:** the documents lying about the city.
- **The words:** street cries in the city's language at that date, built by the archive's own sound laws, voiced, with a gloss on tap.

Tap any name, price or date and its page in the archive opens. At the end your register goes beside the record, and Nambili writes his report from what you found.

> "In AY 332 I wrote that 199 of ours died, because the king was watching. In AY 855 a woman I had never met read my tablet aloud to her grandson. In AY 4925 I catalogued it, and the register said 750." (target player reaction)

## Why it is unlike anything else

- **The history is real inside the game and checkable outside it.** The record is 5,000 simulated years: 106,000 pages, 16,429 battles with true losses, and the chronicles that lied about them. A checker of 19 invariants gates every build. We know of no game that ships its history as an open database.
- **You act on memory, not on events.**
  - Strategy games let you change history: Civilization, Crusader Kings.
  - Walking modes let you witness it: Assassin's Creed's Discovery Tour.
  - Here history is fixed and the archive is yours. That is Palimpsest's own subject, the record against the documents, turned into the mechanic.
- **One place across deep time.** Pentiment follows one town over 25 years. This follows one city over 4,600, whose name drifts by sound law and borrowing: Pumi, Pome, Peme, Pimi, Himi, and Pyim in the excavator's report.
- **Consequences that travel millennia, and that you can trace.** Every figure you touch keeps a lineage: who wrote it, who copied it, who believed it.
- **Generated languages you hear:** Bibbu, Nenan, Nekhko and Birirli, each at its date, with Leipzig glosses.

## The concepts considered

| Concept | Strong | Weak | Verdict |
|---|---|---|---|
| **A. Anthology of 30 cities** (the brief's candidate): a different city's siege each chapter | Variety; 30 scenarios and checked scripts exist | Each chapter needs a new city, kit, cast and language, and nothing carries over. It is The Tablet House at many times the price. | Keep as the free daily game, and later as "other tells" |
| **B. Open world across 5,000 years** | Maximal | No place to master and no end to the scope. Introversion's Subversion was shelved when the tech ate the game. | Reject |
| **C. A dynasty across generations** | A personal thread | The simulation already made every ruler's choices, so the player would be a passenger. Crusader Kings III (4 million sold) owns the genre. | Reject |
| **D. One city through the ages** | Mastery of a place; one plan redressed per era; the record is unusually rich for Himi | Needs a reason to move between eras | **Recommended,** framed by E |
| **E. The archivist** piecing it together | Cheap; phone-friendly; closest to the archive | 2D deduction alone is a smaller game; Heaven's Vault and Obra Dinn have explored it | **The frame and hub** for D |

**Recommendation: D framed by E, one city read down through its destruction layers.** Five reasons:

1. **The record supports it, for this city more than any other.** Himi was founded 245 years before AY 0 and still stands at AY 5000.
   - Its record: 108 battles, 22 sieges, 16 sacks, 8 plagues, 24 treaties and 15 merchant houses.
   - Documents: 163 were written there, and 47 flagships cite it.
   - Rule: it changed masters more than thirty times. Six of its sacks were by a state that kept one name as sound law reshaped it: Yida, then Yeda, Yidha and Yidhe.
2. **The canon already does it.** The Tale *Pour Water for the Tablets* (fl-1003, set in the sack of AY 855) has an apprentice of the same house reading the eyewitness account of AY 332 (fl-354). The dig report exists and names the strata.
3. **It solves the agency problem.** The record's ending is fixed, so the player's power goes over what survives. That is honest to the record and to the archive's central idea.
4. **It is affordable.** The city model already draws Himi at any year, and one plan redressed per era replaces 30 cities. Players learn the river gate, the temple and the house of tablets, then meet them changed.
5. **It scales.** 247 cities in the record were sacked at least once and 43 at least ten times, and the archive holds 311 excavation reports: each is another tell for the same systems.

## What you do

| Layer of play | Where | What you do | Length |
|---|---|---|---|
| **The dig** (hub) | AY 4925, the trench and the finds tent | Sieve a stratum; read finds with transliteration and gloss; date, attribute and judge them (checked in threes, as in Obra Dinn); open the week | 20–40 min per layer |
| **The week** | The city at street level, five days | Carry, run, climb, hide, bargain and persuade; choose what to write and what to save. The record's ending arrives on its date. | 3–5 h per full week |
| **The register** | Back in the tent | What survived turns up in the layer, or doesn't; you catalogue it; the reckoning; the cards | 10–15 min |

**The layers at 1.0.** All fourteen destruction layers of the dig report are playable: seven as full weeks and seven as short layers of 15–20 minutes on the Tablet House engine (the sacks of AY 363, 486, 1831, 3174, 3234, 3252 and 4882). The epilogue follows the dig.

| Book | Year (AY) | From the record | You are (invented unless noted) | New verb |
|---|---|---|---|---|
| I · Clay | 332 | Panshelon, 19, against Shenshetkuth, 68, great queen of Yida; archive burned | the runner of the house of tablets | roofs, ladders, planks |
| I · Clay | 855 | Vanavmanen's 1,625 against Yida's 4,930; 659 and 319 dead | Padiyyiviyath, the counter (fl-1003) | water and jars |
| I · Clay | 1858 | Kolnofmalen the Ill-Starred of Peme against the Yennga Empire; 2,837 against 8,704; archive burned; the Black Ague five years before | to be cast | the plague year |
| II · Skin | 3166 | Medhelonen II against Lovdhan of Tallen; the larger army lost (23,302 against 14,928; 8,582 and 2,019 dead); archive burned | a keeper of the banned Anatofpel books | cellars, pitched roofs, horses |
| II · Skin | 3383 | Nadhdan of Pimi against Tafbafpavbukhin the Just of Yidha; 2,614 against 34,530 | to be cast | the river by boat |
| III · Paper | 4821 | Kuthnakhmaagunin the Last of the City-State of Himi against 624,260 men of the Tallin Empire; conquest | to be cast | the printing press |
| III · Paper | 4918 | Divigvivinge against the Yidhe Empire; 42,028 against 718,494; 15,192 and 2,544 dead; archive burned | the registrar as a child | railways, the telegraph |
| Epilogue | 4951 | The sack after the First Battle of Himi that year; the archive burns again | the registrar, grown, with the dig's finds | — |

**Length:**
- **A first play:** 25–40 hours.
- **Everything:** about 60.
- **Chapter 1** (three weeks) ships first, at 8–12 hours.

There is no Iron Age layer: Himi's states were still Bronze Age at AY 1858, and the city was not sacked again until AY 3166.

## What comes from the record, system by system

The detail is in the HLD, §4.

| System | From the record | Built for the game |
|---|---|---|
| **Traversal** | Roofs by era; the river through the town; a horse's price (257 g of silver in the 330s, 1,116 g in the 4820s); the state's railway from AY 4901 | Roof running, horses, boats, timed trains |
| **Crowds and NPCs** | Rulers and commanders with pages; townspeople named from the city's own people; a census from 20,817 to 813,026 | Day schedules on the siege's beats; faces; instanced crowds |
| **Economy** | 16 goods priced by decade at Himi; coins and their debasement | Weighing silver, hiring, bribing, feeding a neighbour. Scarcity is shown, never an invented price. |
| **Language** | 126 languages with dated sound laws; 373 concepts; IPA and glosses | Voiced street cries; a word journal |
| **Combat** | — | None |
| **Stealth** | The states' arms and colours; curfews from the week's events | Sight, noise, firelight, disguise |
| **Choices** | True, rounded and king's figures; the medium by era | The shadow archive, carried up the layers by stated rules |
| **Discovery** | 163 documents written at Himi; the dig report's 114 finds | Placed at their dates; each opens its page; some unlock routes |
| **Photo and chronicle** | Your figure against the record's | Period plates; cards; the lineage of a lie |

## FAQ for players

**Do I fight?**
- **No.** You never hold a weapon. Soldiers, fire and the curfew are dangers, and capture fades to a line of what it cost.
- **Why not:** the people who carried archives were runners, scribes and counters, and the record's dead are counts, not set pieces. Valiant Hearts, This War of Mine and Pentiment show this works.

**Can I change history?** No. The battle, the sack and the treaty fall on the record's dates. You change what history can say about them.

**Where can I play, and what does it cost?**
- **Free:** the first week (Pumi, AY 332), in the browser.
- **Paid:** the full game for Mac, Windows and Steam Deck through Steam, and for iPhone, iPad and Mac through the App Store, at about $19.99.

**Will it run on my phone?**
- **iPhone:** yes, as the app, iPhone 13 class and newer.
- **The web week:** runs on mid-range phones with a lighter look.

**What language do people speak?** Conversations are in English, as the translation. Street cries, prices, blessings, names and inscriptions are in the city's language at that date. Tap for the gloss.

**How violent is it?** The streets PRFAQ's rules apply:
- fire, flight and plunder are shown;
- there is no blood, no bodies on screen and no child in danger;
- a content note comes before each sack, with a skip for its chase.

## Hard questions

**Isn't this niche?**
- **Yes, at heart.** Pentiment's director said it would not have been made without Game Pass. Pathologic 2's studio called it underperforming, and layoffs followed.
- **Our answers:**
  - **A free front door:** the browser week, the daily Tablet House and the archive.
  - **Hooks that work in one image or 15 seconds.**
  - **A cost base small enough to survive modest sales.**

**Can one person with agents and local models build a 20–60 hour 3D game?**
- **Not at AAA breadth, and it shouldn't try.**
- **The evidence:** steps 1–3 of the streets game were committed on one day, 2026-10-16 (step 1 at 16:12, step 3 at 21:56), with 7,600 lines of TypeScript by step 3.
- **The limit is content and taste.** Code is not the bottleneck.
- **So** each week is held to one hero district generated from the city plan, and each rung of the ladder ships on its own.

**Will local models write well enough?**
- **For bulk text, yes, if validated.** Barks, shop talk and codex blurbs are drafted locally (gpt-oss-120b) and pass the validators that guard the Tablet House scripts: placeholders only, no typed figures, names that exist, no anachronism.
- **The key scenes of each week** are written like the flagships: by Claude, from a dossier, then fact-checked. The Tales' audit checked 2,820 claims and corrected 42.

**Which engine?** It is open. A Godot 4.7 against three.js WebGPU bake-off is running in `~/projects/offshoots/2026-10-engine-bakeoff/`. The HLD (§5) sets out the criteria and leans toward native for the paid game and web for the free week, depending on its numbers.

**Does the game change the record?**
- **No.** The simulation and the language engine are canon. The game reads exports; additions go through the export contract.
- **The player's documents live in the save file**: the "shadow archive".

**The repo is public and MIT. How is the game sold?** That is your decision. The recommended split:
- the archive, the engine and the free web games stay MIT, here;
- the paid game's scripts, assets and runtime live in a new private repo that reads this one's exports.

## Business

**Audience, by reach:**
1. **People who see a card or a clip.** The hook is "Is this real history?" The answer: a simulated one you can check.
2. **Narrative and history players:** Pentiment, 80 Days, Obra Dinn, Heaven's Vault.
3. **Systems and worldbuilding fans:** Dwarf Fortress, Caves of Qud, conlangers.
4. **Teachers and museums.** Discovery Tour reached 2.3 million players by 2019.

**Pricing (recommended):**
- **Free forever:** the archive, the Tablet House, and the browser week.
- **Paid: $19.99** on Steam (Windows, Mac, Deck) and the App Store (one universal purchase).
  - On iOS: a free download with the first week, unlocked once to buy.
  - No ads, no loot, no subscription.
- **Options, decided later:**
  - Chapter 1 in Steam Early Access at $14.99, after the slice's playtests;
  - an Apple Arcade pitch once Chapter 1 exists.

**Virality:**
- **The chronicle card:** "I wrote 199 dead. The record says 750."
- **The lineage card:** one claim's path from AY 332 to AY 4925.
- **Photo plates** in period styles.
- **15-second clips:** a roof run, or a word changing across millennia.
- **The devlog:** a 5,000-year world built on one Mac with local models.
- **Every card links into the free archive.**

**Fees:**

| | Fee | Cut |
|---|---|---|
| Steam | $100 per app, recouped after $1,000 of sales | 30% |
| App Store | $99 a year | 15% (Small Business Program) |
| Godot | none | none |
| Unreal | none up front | 5% of gross above $1 million per product |

**Realistic numbers first.**
- **Steam is crowded:**
  - The median indie game grossed about $249 there in 2025 (VG Insights).
  - Valve counts 5,863 games that grossed over $100,000 that year, against about 19,600 new releases in 2025 alone.
- **The site has no analytics,** so the archive's own reach is unknown. Measuring it is the slice's first business task.

| Case | Year-one units (Steam + App Store) | Net to us (≈55% of gross, after cuts, tax, refunds and discounts) |
|---|---|---|
| Ignored | under 2,000 | under $20k |
| **Planning case** | **8,000–25,000** | **$90k–$275k** |
| Good | 50,000–100,000 | $0.5M–$1.1M |
| Tail | Obra Dinn is estimated at about 615,000 Steam copies over years; Dwarf Fortress sold about 500,000 in its first Steam month on a 20-year audience | — |

**Views.**
- **A well-made trailer and good cards:** plan on 50,000–500,000 views.
- **Millions** is a tail: one post that lands. It is never the plan.

**Cash costs** are small:
- store fees;
- about $25 of CC0 animation tiers;
- two used test phones, about $450;
- optional contractors: a character artist at $3–10k, and playtesters.

The real costs are your time and Claude usage.

**What success looks like:**
- **Vertical slice,** with 20 outside players:
  - at least 60% finish the week;
  - at least 40% open a real archive document from the game;
  - at least half say they would pay.
- **Chapter 1:**
  - 10,000 wishlists before launch;
  - a demo median session of at least 45 minutes;
  - at least 85% positive reviews.
- **1.0:**
  - the planning case;
  - the archive's visits at least double;
  - a second tell is worth starting.

## Risks

The full table is in the HLD, §8. The top three:
1. **Scope.** A 20–60 hour 3D game is how small teams die.
   - **Retired by** a ladder whose every rung ships, with kill criteria at each.
   - **Also by** holding each week to one hero district.
2. **The loop may not carry 30 hours.** "You can't change what happens" may feel powerless, and carry-choose-arrive may thin out.
   - **Retired by** outside playtests of the slice with measured completion.
   - **Also by** a new verb per era, deduction at the dig, and consequences you see a layer later.
3. **Engine and platform.** Web may not carry a long game to iPhone and Steam quality, and native loses the link.
   - **Retired by** the bake-off's numbers.
   - **Also by** runtime-neutral week packs and golden transcripts, so a switch costs a runtime, not the content.

## Decisions for you

1. **An Apple ID for Xcode.** Every iOS path needs Xcode, whether Godot, Unreal or a web wrapper. A free ID builds to your own iPhone; the $99 program is needed for TestFlight and the store.
2. **The engine, from the bake-off.** Unreal, if wanted for a PC-first photoreal game, needs an Epic account and the 5% royalty above $1 million.
3. **The business model:**
   - premium with a free first week (recommended), Early Access, or Apple Arcade;
   - the private-repo boundary;
   - privacy-respecting play counts, without which none of the success measures can be taken.

## Prior art and what we take

| Game | What worked | What limited it | What we take |
|---|---|---|---|
| **Pentiment** (2022) | One town over 25 years, in three acts | Niche by its director's account; funded by Game Pass | One place over time; choices without right answers |
| **Assassin's Creed Discovery Tour** (2018–) | Combat-free walking in history; 2.3M players by 2019; used in schools | A tour without stakes | Walk history without combat, but with stakes |
| **Crusader Kings III** (2020) | Emergent dynastic stories; 4M sold by 2025 | Spreadsheets | We tell its kind of story from the street |
| **Dwarf Fortress** (Steam, 2022) | Depth sells: about 500k in its first Steam month | History surfaces as logs | A few people and places speak for the record |
| **Caves of Qud** (1.0, 2024) | Generated histories found in statues and engraved items | Rationalised after the fact, not simulated | Documents in the world, simulated and checked |
| **80 Days, Heaven's Vault** (inkle) | Choice-dense text on phones; an archaeologist reading a lost language, whose translations can be wrong | Small audiences for text-heavy play | Glossing as play; the dig's deduction |
| **Pathologic 2** (2019) | A town in crisis, with schedules and scarcity | Punishing; underperformed | Pressure gives weight, so offer difficulty options |
| **Return of the Obra Dinn** (2018) | Deduction over a fixed record, checked in threes | — | The register's checks |

## Sources (web figures)

- Crusader Kings III, 4 million: [Paradox, April 2025](https://www.paradoxinteractive.com/media/press-releases/press-release/crusader-kings-iii-passes-four-million-sales).
- Dwarf Fortress, nearly 500k in December 2022: [GameSpot](https://gamespot.com/articles/dwarf-fortress-sells-nearly-500k-copies-in-december/1100-6510369/).
- Pentiment and Game Pass: [Pure Xbox](https://purexbox.com/news/2022/11/obsidian-wouldnt-have-made-pentiment-if-not-for-xbox-game-pass).
- Discovery Tour, 2.3 million: [COGconnected](https://cogconnected.com/2019/10/assassins-creed-discovery-tour/).
- Pathologic 2 underperforming: [Gamepressure](https://www.gamepressure.com/newsroom/pathologic-2-was-a-financial-failure/z81043).
- Caves of Qud's histories: [GDC Vault](https://gdcvault.com/play/1024990/Procedurally-Generating-History-in-Caves), [wiki](https://wiki.cavesofqud.com/wiki/Sultan).
- Heaven's Vault: [PCWorld](https://www.pcworld.com/article/406127/inkles-space-archaeologist-adventure-wont-tell-you-if-your-lost-language-translations-are-wrong.html).
- Obra Dinn estimate (third party): [Raijin](https://raijin.gg/app/653530/Return_of_the_Obra_Dinn).
- Steam in 2025: [Valve's figure via Mezha](https://mezha.ua/en/news/almost-6k-games-earned-over-100k-in-on-steam-in-2025-309376/); [VG Insights' median via Ziva](https://ziva.sh/blogs/indie-game-revenue).
