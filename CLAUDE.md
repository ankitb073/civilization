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

## Commands
- `npm run sim [seed]`: simulate.
- `npm run archive`: generate documents and pages.
- `npm run check`: consistency checker.
- `npm run export`: atlas data.
- `npm run build`: everything, plus the atlas build.
- `npm run dev`: atlas dev server.
- `npm test`: unit tests.
- `npm run typecheck`
- Debug tools: `node engine/src/debug/stats.ts <seed>` and `node engine/src/debug/world-cli.ts <seed> out.png`.
