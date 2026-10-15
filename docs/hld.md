# HLD: Palimpsest

## Pipeline

```
seed ─▶ worldgen ─▶ simulate (50 centuries, decade sub-steps) ─▶ world.sqlite
                                                                   │
              ┌────────────────────────────────────────────────────┤
              ▼                       ▼                            ▼
   procedural artifacts       flagship dossiers ─▶ agents ─▶ flagships/*.md
              │                                                    │
              └──────────────▶ archive assembly (links, backlinks) ◀┘
                                         │
                       ┌─────────────────┼──────────────────┐
                       ▼                 ▼                  ▼
                 checker (CI gate)   vault/ (Obsidian)   atlas data shards ─▶ Vite atlas ─▶ GitHub Pages
```

Everything runs from one command (`npm run build`). The engine is TypeScript, run directly by Node 24 with native type stripping, so there is no compile step. It uses `node:sqlite` for the database. The atlas is a Vite + Preact + TypeScript static app.

## Components

| Component | Path | Responsibility |
|---|---|---|
| RNG | `engine/src/core/rng.ts` | Seeded, named substreams (so changing one system doesn't reshuffle others) |
| Worldgen | `engine/src/world/` | Voronoi cells, elevation, rivers, climate normals, biomes, resources, regions |
| Language | `engine/src/lang/` | Proto-languages, phonotactics, lexicon, morphology, sound-change history, splits, borrowing, romanization, scripts |
| Simulation | `engine/src/sim/` | Climate anomalies, population, settlements, cultures, polities, rulers, war and diplomacy, economy and currency, trade, tech, movements (religion and philosophy) |
| Store | `engine/src/db/` | SQLite schema and writers; century checkpoints (resumable) |
| Artifacts | `engine/src/artifacts/` | Procedural primary sources by type, survival model, editorial apparatus |
| Archive | `engine/src/archive/` | Entity pages, WikiLink resolution, backlinks, Obsidian vault export |
| Checker | `engine/src/check/` | Causal and consistency invariants; report |
| Export | `engine/src/export/` | Atlas data shards, graph layout (ForceAtlas2, precomputed) |
| Atlas | `atlas/` | Map + time slider, graph, reader, search, about/consistency |
| Flagships | `flagships/` | Agent-written Markdown, validated by the checker |

## Core model

- **Time**: integer Archive Years (AY) 0–5000. The macro tick is a century, with ten decade sub-steps. Each event has an exact year inside its sub-step, and that year is never earlier than any of its causes.
- **Space**: about 8k Voronoi cells. Ownership, culture, language and religion are tracked per cell. Territory changes are logged as `(cell, year, owner, event)`, so ownership at any year can be reconstructed exactly.
- **Entities** (each one gets a page): polity, person, settlement, region, river, culture, language, script, movement, currency, merchant house, good, climate anomaly, technology, and event (war, battle, treaty, succession, revolt, collapse, eruption, plague, famine, migration, founding, schism, council, invention, debasement, panic...).
- **Causality**: `event_causes(event, cause_event | condition)`. A *condition* is a recorded state observation, for example "granary stock of polity P below 20% in 2310". Every state mutation carries `event_id`.
- **Artifacts** each have: author (person), year, place, language, script, medium, type, `about` (events), mentions (entities), survival and discovery (find year, find spot, finder, translator), and condition (lacunae).

## The consistency contract (summary; full list in `docs/lld/checker.md`)

1. Every link target exists, and every link has a backlink.
2. A document dated *t* references only entities with `start ≤ t` and events with `year ≤ t`.
3. An author is alive and literate in the document's language at *t*. The script existed in that place at *t*.
4. A ruler named in a title held office at *t*. Reigns don't overlap.
5. Ceded territory in a treaty equals the territory log entries of its event.
6. Ledger prices are within tolerance of the simulated price series for that market and decade, in a currency that circulated there.
7. Names are rendered in the document's language and stage: forms come from that language's sound-change history at *t*.
8. The cause graph is acyclic and time-respecting.

## Data contract to the atlas

These are static JSON files under `atlas/public/data/`, and the atlas loads them lazily.

- `meta.json`: seed, version, counts, eras, checker summary.
- `world.json`: cell polygons (quantized), cell attributes, rivers, regions.
- `timeline.json`: polities (names over time, colors, life spans); ownership keyframes every century plus a delta log; settlements; event markers; climate series.
- `graph.json`: nodes (id, type, label, x, y, t0, t1, degree) and edges (s, t, kind), laid out at build time by ForceAtlas2.
- `search.json`: a compact search index (titles, aliases, name variants).
- `pages/NNN.json`: sharded entity and artifact bodies (Markdown and metadata).

A full LLD exists for each component in `docs/lld/`.

## Non-functional

- **Determinism**: the same seed and the same code produce an identical database, so CI can diff.
- **Speed**: the full build takes under 10 minutes on a laptop. The atlas's first load is under 1.5 MB gzipped. Everything else is lazy.
- **Responsive**: the atlas is usable at 360 px wide and up, with touch-friendly controls on phones.
- **Open**: MIT license, no API keys, no server.
