# LLD: Archive and artifacts (`engine/src/archive/`, `engine/src/artifacts/`)

## Editorial frame

The archive presents itself as the work of the world's own modern scholars, at around AY 4850–5000.

- **Editorial language:** the language of the leading polity at AY 5000 (the most populous, among those that know computing).
- **Editorial names:**
  - Ancient entities: the native form at their floruit, in conventional romanization. This is the convention real scholarship uses ("Ugarit", "Hattusa").
  - Living places: the modern local form.
  - Every page lists its names through time and across languages.
- **Dates:** each document carries its *local* date:
  - regnal years ("the 12th year of Ashur-dan II");
  - foundation eras ("year 412 of Kadrum");
  - religious eras ("year 1022 of the Awakening");
  - telegraph-age common eras.

  Each date is followed by the normalized `AY` year.
- **Catalog numbers:** `PAL·<TYPE>·<00000>`.
- **Provenance:**
  - Durable media were excavated in the modern era by named archaeologists.
  - Manuscripts survive in named libraries.
  - Printed and electronic records come from state archives.
  - Each translator is a modern scholar specializing in the language's family.

## Naming

- **Rulers:** regnal numbers when a name repeats in a polity's line. Epithets come from deeds: victories, defeats, building, piety, length of reign.
- **Polities:** titled by the government form they held longest ("Kingdom of X", "the X Empire", "the X Horde").
- **Events:**
  - Ordinals for repeated pairings ("Second Kadrum–Vell War").
  - Place-based names: battles take the nearest town, region or river; treaties take their signing place.
  - Named plagues ("the Grey Fever"), eruptions ("Eruption of Mount X"), droughts and cold spells.
- **Collisions:** titles are unique; collisions get a qualifier and years.

## Survival

`p = durability(medium) · exp(−age/τ(medium)) · catastrophe`

- Clay and stone are durable. Papyrus and parchment are fragile. Paper is medium. Print and electronic records are durable.
- The sack of a city with `burnedArchives` destroys most perishable documents held there.
- Some lost documents are known only from quotations in later ones.

## Generators (each returns title, body, mentions, metadata)

| Type | Trigger | Notes |
|---|---|---|
| treaty | peace and alliance treaties | Formulae vary by era and culture: Bronze Age "Thus says…" oaths and curses → articles → "High Contracting Parties"; terms match the structured data exactly |
| chronicle (rival) | wars with literate parties | Two accounts with a bias model: inflate own victories and enemy losses, omit defeats, blame the other side's casus belli, credit own gods; the page compares them with the truth |
| inscription | victory stelae, dedications, boundary stones, epitaphs | Clause structures → engine render (transliteration, gloss, translation); lacunae from condition |
| ledger | merchant houses | Entries from the house's partners and goods at simulated prices in the circulating currency; notes cite wars and famines |
| letter | rulers and merchants | Bronze Age "To X, my brother, speak!" formula; later epistolary forms |
| decree | coinage, debasement, conversions, persecutions, price controls in famines | |
| annals | per polity per century | Year entries for the main events, in the polity's voice |
| religious / philosophical | founding sayings, creeds, council acts, polemics | Text from the tenet vectors |
| census | polity population by region | Numbers from the simulation |
| record | famine, plague and eruption accounts | Temple or weather records |
| coin | numismatic entries | Weight follows the debasement history |
| travelogue | one traveller per century along trade routes | Rulers, faiths and prices as observed |
| newspaper, pamphlet, telegram, debate, market report | era ≥ 4 to 5 | |
| scholarship | excavation reports, proto-language reconstructions, climate papers | Modern editors |

## Linking

Bodies use `[[id|display]]`. The display text is the entity's name as that document would write it (its language and date); the target is the canonical page. Backlinks are computed over every page.
