# How Palimpsest works

Palimpsest is an archive of a civilization that never existed. It is built in three layers:

- a simulation that decides what happened;
- an archive that decides what was written down and what survived;
- a checker that refuses to publish anything the record contradicts.

This note walks through each layer with examples from the canonical world, Yüvinzhi (seed 5).

## 1. One seed, one world

Everything starts from a single integer. The world generator scatters about 7,900 Voronoi cells over the map, raises continents with layered noise, and fills depressions so water always has somewhere to go (priority flood). It then routes rivers by flow accumulation and pushes moisture inland on the prevailing winds, so mountains cast rain shadows. Biomes follow temperature and rainfall (a Whittaker diagram). Resources are scattered with intent: tin is rare, so a Bronze Age state that wants bronze has to trade or fight for it.

All randomness flows from named streams (`rng.fork('war', polityId, year)`) rather than one global sequence. A change to how famines are drawn therefore doesn't reshuffle every later war. That property is what makes the archive stable enough to write literature against.

## 2. Five thousand years, year by year

The simulation steps through 50 centuries in decades. Politics and war run every year inside each decade. Every change of state goes through one function, `event()`, which records what happened, who took part and what caused it. A cause can never postdate its effect. Over the run, about 49,000 events are linked by 45,000 cause edges.

The systems interlock:

- **Climate:** an autoregressive temperature series, punctuated by eruptions (a VEI 7 cools the world by about 1 °C for years), droughts that sit on regions for decades, and industrial warming at the end.
- **People:** harvests depend on climate and soil. Famine kills and drives migration. Plagues travel along trade routes, worst where they arrive for the first time.
- **States:** states form, expand, fight, sign treaties, fracture in civil wars, and collapse when crises pile up. They follow secular cycles: long reigns, then usurpations and secessions, then breakup.
- **Money and trade:** prices are set per market and per decade from harvests and silver stocks. Coins are debased when treasuries run dry. Merchant houses rise and go bankrupt. A panic can bring down trade across an ocean.
- **Ideas:** religions and philosophies have tenet vectors. They spread, split in schisms, hold councils and persecute their rivals. Technologies spread from a calibrated hazard, from writing (AY 60) to computer networks (AY 4960).

Territory, culture and religion are written to append-only logs: 199,575 border changes alone. Replaying the logs from the initial state must reproduce the final map exactly, and the checker verifies that it does.

## 3. Languages that drift

Each people speaks a language descended from one of six proto-languages. A language accumulates sound changes over time (lenition, apocope, vowel breaking, palatalization…), timed by a Poisson process and written in standard notation (`k > ʔ`). When a people splits, the daughter language inherits every change up to the split and then goes its own way. Words are borrowed with phonological adaptation, and places get exonyms.

The proto-Tasemem word for water, *kikweka*, becomes *'ikwe'a* by glottalization, *'igwe'e* by intervocalic voicing (AY 381), *yegwe* (AY 1288), *yebe* (AY 2112) and finally *yiv* in Simem (AY 4919). In Tasemem itself the old word was replaced in AY 1509 by a borrowing, *usashi*, which wore down to *uash*. The Word Machine view traces 114 words through all 126 languages this way.

Five kinds of script carry these languages, from logosyllabic systems with borrowed logograms to alphabets. An inscription is generated as a clause, then rendered as transliteration, normalized text, a Leipzig interlinear gloss and an English translation. All four come from the same structure, so they always agree.

## 4. The archive: what was written, and what survived

About 35 document generators read the record and write what a society of that age would have written:

- treaties whose terms are the simulation's terms;
- ledgers priced from the market series;
- victory steles that inflate the enemy dead about sixfold;
- chronicles from both sides of a war, each lying in its own way;
- omen tablets, customs tariffs, itineraries, wills, lawsuits, school exercises with corrections, newspapers and telegrams.

Every document is dated in its own culture's calendar: regnal years, foundation eras, religious eras.

The Treaty of Iemi (AY 873), for example, cedes three districts and region 6 from one state to another. It also sets a tribute of 163 kg of silver a year for 39 years, makes the loser a vassal, and imposes a ten-year truce. The treaty text names exactly those districts. The checker confirms that each changed hands in AY 873, to the beneficiary, under that treaty's event.

Then time does its work. Each document gets a medium (stone, clay, parchment, paper, newsprint) and a survival probability that decays with age and with the sacks its archive suffered. Of about 36,000 documents written, about 18,500 survive. Clay and stone dominate the early record, newsprint the late one. Lost works can still be known through quotation: 453 survive only as fragments in later texts. Excavations, each with a site and an excavator, bring documents back. Modern translators sign their editions.

## 5. Flagships: literature written against a fact sheet

Some documents are written by AI agents instead of generators: epic fragments, letters from the front, laments, sermons, the diaries of ordinary people, 40 Lives and a 21-chapter *History of Yüvinzhi*. Each starts from a dossier assembled from the record. The dossier contains:

- **Facts cut at the document's date.** An author writing during a war doesn't know how it ends.
- **An author** who was alive and old enough at that date.
- **Context:** the ruler, the state religion and its tenets, the currency and the price of grain, and the newest technologies (and the next ones not yet invented).
- **A whitelist of links**, with each person's and god's sex.

Fact-checker agents then compare every file with the database. The commonest slips are a war goddess turned male, a war's first year off by one, and an era counted from the wrong founding. The checkers fix only real contradictions and keep the bias: a chronicler may lie, but he may not get his own queen's sex wrong.

## 6. The checker

The checker reads only `world.sqlite`. It shares no code with the simulation, so it is an independent audit. On the current build it verifies 15 invariants across about 1.9 million facts:

| Invariant | Facts checked |
|---|---|
| Every cause precedes its effect, and the cause graph has no cycles | 45,012 each |
| Every territorial change is in order and held by a living state | 199,575 and 140,313 |
| Replaying the logs reproduces the final map | 7,910 cells |
| Every ceded district changes hands at the treaty date | 28,830 |
| Every office is held only while alive, and no state has two heads at once | 94,668 and 7,599 |
| No document mentions anything that didn't yet exist | 202,025 links |
| Every author was alive and at least 12 | 14,453 |
| Every document's language and script existed at its date | 18,490 |
| Every ledger price is within 20% of the market | 13,002 |
| Every catalogue number a document cites exists and predates the citation | 8,079 |
| Every link resolves, and backlink counts match | 1,053,185 |

Continuous integration runs the checker on every push, and any violation fails the deploy. The citations invariant earned its place on its first day. A change to how reigns were computed would have renumbered dozens of documents that the *History* cites, and it was caught before it shipped.

## 7. What it doesn't do

- **Prose is not fully checked.** Unlinked text in a flagship could still mention something too early. Dossiers, fact-checkers and the technology line in each dossier make this rare, not impossible.
- **The simulation has known simplifications,** filed as issues: early armies can be implausibly small, and army strength is not headcount.
- **It is one world.** Other seeds build and pass the checker, but only seed 5 has the agent-written literature, because flagships are tied to that world's ids.

## Run it yourself

```bash
npm ci && npm ci --prefix atlas
npm run build:data      # simulate, write the archive, audit, export (≈1 min)
npm run dev             # the atlas, locally
```
