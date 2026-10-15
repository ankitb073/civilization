# Palimpsest: a 5,000-year synthetic civilization archive

**Brief.** A deterministic simulation of a fictional world, stepped century by century (decade sub-steps, yearly politics and war) from the Bronze Age (AY 0) to a post-industrial era (AY 5000). A local SQLite database is the record of truth.

From that record we generate thousands of interlinked primary-source documents: treaties, ledgers, glossed inscriptions and rival chronicles. A consistency checker gates every build. A static web atlas (time slider, force-directed graph, reader) ships on GitHub Pages.

## Key docs
- `docs/prfaq.md`: what and why.
- `docs/hld.md`: architecture, pipeline, and the consistency contract.
- `docs/lld/*.md`: one design per component (world, language, simulation, artifacts, checker, atlas).
- `docs/decisions/`: one file per decision (context, decision, why).

## Conventions
- **Runtime:** Node ≥ 24, TypeScript executed directly (type stripping).
  - No enums, namespaces or parameter properties.
  - Imports use explicit `.ts` extensions; use `import type` for types.
- **Determinism:** never use `Math.random`. Draw from `Rng.fork(label, …)` streams keyed by stable labels (entity ids, years), so a change in one system doesn't reshuffle others.
- **Causality:**
  - Create every state change through `event()` in `engine/src/sim/state.ts`; causes must not postdate effects.
  - Territory, culture and religion changes go through `setOwner`, `setCulture` and `setReligion`. Their logs must be appended in year order.
- **Engine/atlas contract:** `engine/src/export/contract.ts` is the only interface between them.
- **Bugs:** log them as GitHub issues labelled P1/P2/P3.
- **Commit identity:** `38665863+ankitb073@users.noreply.github.com`.

## Canon and flagships (read before changing the simulation)
- The canonical world is seed 5 (decision 0009).
- `flagships/*.md` are agent-written sources tied to simulation ids. Each carries a `world:` fingerprint of the simulation's events.
- Any change under `engine/src/sim/**` changes ids. Ingestion then rejects every flagship as written for another world. Afterwards, regenerate the dossiers (`node engine/src/cli/dossiers.ts 5 240 [--wave=2|3]`) and rewrite or revalidate the flagships (docs/lld/flagships.md, decision 0010).
- Archive-level changes are safe.
- Modern essays quote existing procedural documents and their catalogue numbers. Don't reword existing generators except to fix bugs. Add new genres in new files with new catalogue codes.

## Exports (atlas/public/data, see engine/src/export/contract.ts)
- meta, world, timeline (with lazy layer-culture and layer-religion), graph, search, pages/NNN;
- story, histomap, languages, economy, collections, dynasties.

## Commands
- `npm run build:data [-- seed] [--no-downloads]`: simulate, archive, database, audit, atlas data, vault and downloads (about 1 min).
- `npm run sim [seed]`: simulate only, into build/world.sqlite.
- `npm run check [db]`: audit a world database (exits non-zero on any violation).
- `npm run build`: build:data plus the atlas build.
- `npm run dev`: atlas dev server.
- `npm test`: determinism, world, invariants, archive and checker tests.
- `npm run typecheck`
- `npm run stats -- <seed>`
- Debug tools: `node engine/src/debug/stats.ts <seed>`, `node engine/src/debug/world-cli.ts <seed> out.png`, `node engine/src/debug/peek.ts <seed> <sub> <n>`, and `node engine/src/debug/scan.ts <from> <to>` (seed scoring).
- Isolated build (avoids clobbering other builds): `node engine/src/cli/build.ts --no-downloads --db=/tmp/x.sqlite --out=/tmp/data`.
- Atlas: `npm --prefix atlas run shoot`, `npm --prefix atlas run frames` (borders animation), `npm --prefix atlas run mock`.
