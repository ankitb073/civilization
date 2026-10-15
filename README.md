# Palimpsest

**A 5,000-year archive of a civilization that never existed.** [Open the atlas →](https://ankitb073.github.io/civilization/)

Palimpsest generates a world from a single seed and simulates it century by century, from the first bronze-working river cities to a post-industrial age of networks. It then writes the archive such a world would leave behind:

- treaties whose ceded provinces match the map;
- merchant ledgers whose prices follow harvests, wars and debased coin;
- royal inscriptions in reconstructed languages, with transliteration, interlinear gloss and translation;
- rival chronicles of the same war, each lying in its own way, and modern scholars arguing about them.

Every document links to the people, places, states and events it mentions, and every page links back. A consistency checker audits the archive against the causal record on every build: about 1.8 million facts, zero violations.

<!-- screenshots -->

> Fiction. The peoples, languages and events are generated; any resemblance to real history comes from shared dynamics, not copying.

## The canonical world: Yüvinzhi (seed 5)

| | |
|---|---|
| Years simulated | 5,000 (50 centuries × 10 decades, politics and war year by year) |
| States | ~2,000, from Bronze Age city-states to industrial federations |
| Wars | ~5,000, with ~17,000 battles and ~3,500 peace treaties |
| People with pages | ~35,000 rulers, generals, prophets, merchants, inventors, scribes and scholars |
| Languages | ~125 in six families, each with dated sound laws |
| Surviving documents | ~16,000 of ~29,000 written, across 25 genres, including ~450 lost works known only from quotation |
| Flagship sources | ~240 literary documents and scholarly essays written from database dossiers and validated by the checker |
| Pages and links | ~100,000 pages, ~850,000 links, all bidirectional |

## What's inside

| Layer | What it does |
|---|---|
| **World** | Voronoi continents, rivers by flow accumulation, rain shadows, biomes, and resources (rare tin forces Bronze Age trade). |
| **Simulation** | Climate (volcanic winters, droughts, cold centuries, industrial warming), population and famine, cities, states, succession and usurpation, war and treaties, revolts, collapse, trade routes, prices, currencies and debasement, merchant houses and panics, plagues along trade routes, first contact across the ocean with virgin-soil epidemics, colonies and colonial wars, religions and schisms, philosophies and ideologies, and technology from writing to computer networks. |
| **Languages** | Proto-languages with Poisson-timed sound changes (lenition, apocope, palatalization…), daughters that inherit up to the split, borrowing with phonological adaptation, five kinds of script, and Leipzig glosses. A city's name in a Bronze Age inscription and in a modern newspaper are linked by dated sound laws. |
| **Archive** | 25 genres: treaties, rival chronicles, stelae, dedications, boundary stones, epitaphs, ledgers, letters, decrees, annals, censuses, temple records, coins, travelogues, scriptures, council acts, polemics, newspapers, telegrams, debates, exchange reports, yearbooks, pamphlets, patents, excavation reports, scholarly papers, plus fragments of lost works. Each has a local date (regnal years, foundation eras, religious eras), a catalogue number, survival odds, an excavator and a translator. |
| **Flagships** | For each of ~240 turning points, a dossier of facts *cut at the document's date*, a real author who was alive then, and a whitelist of links. AI writers turn each dossier into a literary source or a modern essay. Ingestion validates every link and date, and the checker audits the result like any other document. |
| **Checker** | 14 invariants verified from the SQLite database alone: causes precede effects, the logs replay exactly to the final map, every ceded district changes hands at the treaty date, no document mentions anything that did not yet exist, authors were alive and of age, ledger prices match the market series, and every link resolves both ways. |
| **Atlas** | Vite and Preact static site: map with time slider and political, peoples and faiths layers; a WebGL graph of every entity and event; a reader with period styling; a "record vs. accounts" view for rival chronicles; browse by genre; downloads. |

## Run it

Requires Node ≥ 24.

```bash
npm ci && npm ci --prefix atlas
npm run build:data      # simulate → archive → world.sqlite → audit → atlas data (≈1 min)
npm run dev             # open the atlas locally
```

```bash
npm run build:data -- 18   # another world (flagships apply only to the canonical seed 5)
npm run check              # audit build/world.sqlite (exits non-zero on any violation)
npm test                   # determinism, invariants, archive and checker tests
```

`npm run build:data` also writes `build/vault/` (an Obsidian vault with a "Start here" note) and the downloads offered on the site. The database schema is described in [docs/data-dictionary.md](docs/data-dictionary.md).

## How it fits together

```
seed → worldgen → simulate (50 centuries × 10 decades, yearly politics) → world.sqlite
                                                       ↓
     archive (names, local dates, 25 genres, survival, fragments, flagships, pages, links)
                                                       ↓
            checker (reads the DB only)   vault (Obsidian)   atlas data → static site
```

Design documents live in `docs/`:

- [`prfaq.md`](docs/prfaq.md): why the project exists.
- [`hld.md`](docs/hld.md): architecture.
- `lld/`: one design per component.
- `decisions/`: one short record per decision, including why seed 5 is canonical.

## License

MIT. See [LICENSE](LICENSE).
