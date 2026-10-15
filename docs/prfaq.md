# PRFAQ: Palimpsest, a 5,000-year synthetic archive

## Press release

**Palimpsest opens a complete archive of a civilization that never existed: 5,000 years of treaties, ledgers, inscriptions and rival histories, all cross-linked and all consistent.**

A world is generated from a single seed. It is then simulated century by century, from the first bronze-working river cities to a post-industrial network age. A local SQLite database records every border change, drought, volcanic winter, debased coin, sound change, schism, war and peace. Palimpsest then writes the archive that such a world would leave behind:

- treaties whose ceded provinces match the map;
- merchant ledgers whose prices follow the simulated harvests and currency debasements;
- monument inscriptions in reconstructed languages, with transliteration, interlinear gloss and translation;
- pairs of chronicles that disagree about the same battle, because their authors served opposite kings.

Every document links to the people, places, polities and events it mentions, and every entity page links back. A consistency checker runs on every build and checks the whole archive against the causal record. Nobody quotes a treaty before it was signed. No coin is minted by a state that doesn't exist yet. No inscription uses a script that hadn't been invented.

The archive ships as an open-source, self-hosted web atlas:

- a map with a 5,000-year time slider;
- a force-directed graph of every entity and event;
- a reader for every document.

It also ships as a downloadable SQLite database and an Obsidian vault.

> "I scrubbed the slider to the drought of the 2300s and watched three empires come apart. Then I opened the grain ledger of a merchant house in the capital, and the price of barley had tripled in exactly those years." (target reader reaction)

## FAQ

**Who is this for?**
Worldbuilders, history nerds, conlangers, and people who like procedural generation or data visualization. It's also for anyone who enjoys falling into a wiki hole. It's a showcase for what a deterministic simulation plus generated text can do when consistency is enforced rather than hoped for.

**What's actually new?**
Others have shipped history generators (Dwarf Fortress Legends), map generators (Azgaar), sound-change tools (Lexurgy) and wiki tooling (WorldAnvil, Obsidian). Palimpsest combines several things none of them do together:

1. *Primary sources* rather than encyclopedia summaries, written in period voice, with biased and conflicting accounts.
2. Place names that evolve by real sound laws. A city's name in a Bronze Age inscription and in an industrial-era newspaper are linked by a documented chain of sound changes.
3. A causal ledger and checker that proves the archive is internally consistent.
4. A static, fast, phone-friendly atlas.

**Is it really "strictly causal"?**
Every state change in the simulation is made by an event. Every event records its causes, and those causes are strictly earlier events or recorded conditions. Every document records its author, date, place, language and script. `npm run check` checks the invariants listed in `docs/lld/checker.md` and fails the build on any violation. The atlas's About page reports the counts.

**Is it reproducible?**
Yes. The same seed and code version produce byte-identical databases. The published world uses a canonical seed chosen from a batch of candidate runs. The selection criteria are recorded in `docs/decisions/`.

**Who wrote the prose?**
Most documents are written by a procedural engine from simulation state, using era- and culture-specific formulae. Several hundred flagship documents (major treaties, founding chronicles, philosophical polemics) were written by AI agents. Each agent worked from a dossier generated from the database, and the same checker validates every link and date in those documents.

**How big is it?**
The target is 10,000+ documents and 20,000+ linked entities and events, spanning 50 centuries, dozens of polities and a family tree of languages.

**What does it cost to run?**
The simulation, generation and checking run locally in minutes with no API calls. The site is static and hosted free on GitHub Pages.

**What doesn't it do?**
It doesn't model individuals' inner lives beyond what documents need, or individual battles tactically. It doesn't depict real history, and any resemblance comes from shared dynamics, not copying. Prose in procedural documents is formulaic in places, as real administrative documents are.
