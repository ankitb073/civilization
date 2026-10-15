# Palimpsest

**A 5,000-year archive of a civilization that never existed.**

Palimpsest generates a world from a single seed and simulates it century by century, from the first bronze-working river cities to a post-industrial age of networks. It then writes the archive such a world would leave behind:

- treaties whose ceded provinces match the map;
- merchant ledgers whose prices follow harvests, wars and debased coin;
- royal inscriptions in reconstructed languages, with transliteration, interlinear gloss and translation;
- rival chronicles of the same war, each lying in its own way.

Every document links to the people, places, states and events it mentions, and every page links back. A consistency checker audits the whole archive against the causal record on every build.

The result is a static web atlas with a 5,000-year time slider, a force-directed graph of every entity and event, and a reader for every document. It also ships as a downloadable SQLite database and an Obsidian vault.

> Fiction. The peoples, languages and events are generated; any resemblance to real history comes from shared dynamics, not copying.

## What's inside

| Layer | What it does |
|---|---|
| **World** | Voronoi continents, rivers by flow accumulation, rain shadows, biomes, and resources (rare tin forces Bronze Age trade). |
| **Simulation** | Climate anomalies (eruptions, droughts, cold centuries, industrial warming), population and famine, cities, states, succession and usurpation, war and treaties, revolts, collapse, trade routes, prices, currencies and debasement, merchant houses and panics, plagues along trade routes, religions, schisms, philosophies and ideologies, and technology from writing to computer networks. |
| **Languages** | Proto-languages with real sound-change histories (lenition, apocope, palatalization…), splits into families, borrowing with phonological adaptation, five kinds of script, and Leipzig-style glosses. A city's name in a Bronze Age inscription and in a modern newspaper are linked by dated sound laws. |
| **Archive** | Treaties, chronicles, stelae, dedications, boundary stones, epitaphs, ledgers, letters and more. Each comes with a local date (regnal years, foundation eras, religious eras), a catalogue number, survival odds, an excavator and a translator. |
| **Checker** | 14 invariants verified from the SQLite database alone: causes precede effects, the logs replay exactly to the final map, every ceded district changes hands at the treaty date, no document mentions anything that did not yet exist, authors were alive and of age, ledger prices match the market series, and every link resolves both ways. |
| **Atlas** | Vite and Preact static site: map with time slider and political, peoples and faiths layers; a WebGL graph; a reader with period styling; a "ground truth vs. accounts" comparison view. |

## Run it

Requires Node ≥ 24.

```bash
npm ci && npm ci --prefix atlas
npm run build:data      # simulate → archive → world.sqlite → audit → atlas data (≈1 min)
npm run dev             # open the atlas locally
```

Other commands:

```bash
npm run sim -- 7        # simulate seed 7 into build/world.sqlite
npm run check           # audit build/world.sqlite (exits non-zero on any violation)
npm test                # unit tests
npm run stats -- 7      # quick statistics for a seed
```

`npm run build:data` also writes `build/vault/` (an Obsidian vault) and the downloads offered on the site.

## How it fits together

```
seed → worldgen → simulate (50 centuries × 10 decades, yearly politics) → world.sqlite
                                                       ↓
                            archive (names, dates, documents, survival, pages, links)
                                                       ↓
                 checker (reads the DB only)   vault (Obsidian)   atlas data → static site
```

Design documents live in `docs/`:

- `prfaq.md`: why the project exists.
- `hld.md`: architecture.
- `lld/`: one design per component.
- `decisions/`: one short record per decision.

## License

MIT. See [LICENSE](LICENSE).
