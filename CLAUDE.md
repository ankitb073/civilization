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
- Any change under `engine/src/sim/**` changes ids. Ingestion then rejects every flagship as written for another world. Afterwards, regenerate the dossiers (`node engine/src/cli/dossiers.ts 5 240 [--wave=2|3|4|5|6|7|8]`) and rewrite or revalidate the flagships (docs/lld/flagships.md, decision 0010). Run it from the repo root (it ingests `flagships/`); it overwrites `build/dossiers`, whose allowedLinks validate the existing flagships, so use `--out=<dir>` to regenerate for comparison.
- The language engine (`engine/src/lang/**`) is canon too. Flagships quote names and words as plain text, and the world fingerprint covers simulation events only, so a language change silently renames the world. Even renaming a sound law's label does this, because rule selection counts labels. `engine/test/canon.test.ts` pins seed 5's languages; if it fails, revert.
- Archive-level changes are safe only if they keep catalogue numbering: flagships cite documents by catalogue number, and the `citations-resolve` invariant fails the build if a citation breaks. Don't change which documents a generator emits, or the order of RNG draws, without checking it.
- Flagship catalogue numbers are frozen in `flagships/catalog.json`; generated documents skip them (`catalogue-unique` invariant). A flagship's condition, provenance and lacunae are drawn from its frozen id, so they no longer move when the generated archive changes.
- A change to the record that keeps the world (same fingerprint) can still make flagships wrong: figures, who lost more, signatories, the text of cited documents. Before merging one, build before and after databases and run `node engine/src/debug/flagship-packets.ts before.sqlite after.sqlite --out=build/packets` (add `--dossiers-before/--dossiers-after` for fact-sheet diffs). Revise every flagged flagship from its packet; afterwards `--strict` lists what is left. Flagships quote other flagships (the History especially), so reconcile those last. Decision 0015 records how stage 1 was done.
- Some Lives are about people the archive generator creates, not the simulation (scribes, envoys, priests, scholars; ids at or above `simPersons`). Their ids depend on the order in which generators create people, so don't change which persons a generator creates, or in what order, without checking those Lives' `subject:` ids against the new pages.
- Tales (fl-1001 and up, `form: short story`, genre `story`, catalogue code ST, decision 0026) come from dossier wave 8 (`--wave=8`); they are fiction set at record moments, ordered by setting year in the collection, EPUB and share series, and kept out of the History's sources.
- Modern essays quote existing procedural documents and their catalogue numbers. Don't reword existing generators except to fix bugs. Add new genres in new files with new catalogue codes.

## Exports (atlas/public/data, see engine/src/export/contract.ts)
- meta, world, timeline (with lazy layer-culture and layer-religion), graph, search, pages/NNN;
- story, histomap, languages, economy, collections, dynasties, game, deck (Clash of the Ages, `#/cards`, decision 0021).
- figures (the Lives' subjects as figurines, `#/figures` and "View as a figure" on person pages, decision 0023).
- museum (26 celebrated documents picked by rules over the record, each with a trimmed page, for the Museum `#/museum`; every artifact page's "View in 3D" builds its model from the page itself, decision 0027).
- scenarios (The Tablet House, `#/tablet`, docs/lld/tablet-house.md): ~30 sieges and sacks read from the record, recounted from world.sqlite by `engine/test/scenarios.test.ts`.
- river (every state as a ridge in a valley of years, for the River of Time `#/river`, engine/src/export/river.ts, decision 0022).
- cities (each settlement's census, walls, sacks, faith and age by year, for `#/city/set:N?y=Y`, engine/src/export/cities.ts, decision 0024).
- Heraldry: pages carry `arms` (states, cities, faiths) or `sigil` (persons), specs read from the record; `atlas/src/heraldry.ts` draws them as SVG, the same everywhere.
- Battles: battle pages carry `battle` (engine/src/export/battle.ts): the record's figures plus `claims` parsed from surviving documents' text, for the diorama `#/battle/evt:N` (decision 0025). Rewording a stele, telegram, newspaper, muster or rival-chronicle template changes what is parsed (`engine/test/battle.test.ts` fails if chronicle, stele or muster claims vanish).
- Downloads (full builds only): `palimpsest-reader.epub` (engine/src/export/book.ts), the Obsidian vault zip, and world.sqlite.gz.

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
- Realism audit of built databases (battle losses, army sizes, fixed-bug recurrence): `node engine/src/debug/realism.ts a.sqlite [b.sqlite …]`. Flagships left stale by a record change: `node engine/src/debug/flagship-drift.ts before.sqlite after.sqlite --list` (summary) and `node engine/src/debug/flagship-packets.ts before.sqlite after.sqlite --out=dir [--strict]` (per-flagship revision packets) (decision 0015).
- Isolated build (avoids clobbering other builds): `node engine/src/cli/build.ts --no-downloads --db=/tmp/x.sqlite --out=/tmp/data`.
- The EPUB alone: `node engine/src/cli/reader.ts [out.epub]`.
- Atlas: `npm --prefix atlas run shoot`, `npm --prefix atlas run frames` (borders animation), `npm --prefix atlas run mock`.
- The Tablet House (`#/tablet`, decision 0028): `npm --prefix atlas run tablet -- [--city=sc-…] [--only=desktop|phone] [--reduced] --out=dir` plays it through in a browser with screenshots, axe and the share card (build the atlas first). Scripts in `scenario-scripts/` are bundled at build time.
- 3D relief (`#/3d`, decision 0020): `npm --prefix atlas run shoot3d -- --out=dir` (screenshots + frame times), `npm --prefix atlas run film -- --out=dir [--formats=wide,square,vertical] [--every=60 --sheet]` (renders the `#/3d?cinema=1` fly-through to MP4 with ffmpeg; build the atlas first).
- Figurines (decision 0023): `npm --prefix atlas run figures` renders a transparent 512×512 portrait of each Lives subject into `atlas/dist/s/fig/` and checks each piece is identical when built from `figures.json` and from the person's page (build the atlas first).
- River and cities (decisions 0022, 0024): `npm --prefix atlas run shoot-river -- [--out=dir] [--years=500,2500,4800]` and `npm --prefix atlas run shoot-city -- [--out=dir] [--theme=light|dark] [--only=desktop|phone]` (build the atlas first).
- The Museum (decision 0027): `npm --prefix atlas run shoot-museum -- [--out=dir] [--ids=art:1,art:20] [--only=desktop|phone] [--theme=dark] [--hall=0] [--viewer=0]` screenshots every museum object in the viewer (normal and raking light) and the hall, with build and frame times (build the atlas first).
- Tablet House scripts: `node engine/src/cli/scenario-sheets.ts` writes a writer's fact sheet per scenario to `build/scenarios/<id>.json`; `node engine/src/debug/scenario-validate.ts <id>|--all` checks `scenario-scripts/<id>.json` (format in docs/lld/tablet-house.md, model `scenario-scripts/sc-18225.json`).
- Tablet House sound (`atlas/src/audio/soundscape.ts`, procedural WebAudio, no audio files): `npm --prefix atlas run sound -- [--out=dir] [--seconds=10]` renders each beat offline and reports loudness, peaks, clipping and CPU.
- Runner of the Tablet House (`#/streets`, decision 0030, docs/streets/): `npm --prefix atlas run streets -- [--city=set:N] [--y=YEAR] [--only=desktop|phone] [--reduced]` walks a scripted path and screenshots walk, run, jump, wall and roof, with frame, physics and collider stats (build the atlas first). `node scripts/streets/runner-asset.ts` rebuilds `runner.glb` from the CC0 sources in `atlas/public/game/streets/LICENSES.md`.
- Streets world (decision 0031): `npm --prefix atlas run streets-world -- [--only=desktop|phone] [--net=4g] [--fingerprint --save=file|--compare=file]` screenshots Pumi's places, tests walking and climbing, and fingerprints the city model to prove other views unchanged (build the atlas first).
- Tablet House painted art (decision 0029, `atlas/public/game/art/art.json`): `node scripts/art/tablet-art.ts gen|process|prompts` regenerates it on the local ComfyUI (~/projects/comfyui, port 8188, Wan 2.2 T2V A14B); notes and rejects in `docs/art/ART.md`.
- Tablet House backdrop (`atlas/src/game/tablet/backdrop.ts`, `mountBackdrop(el, scenario, beat)`): dev harness `/dev/backdrop.html?sc=0&beat=walls` on `npm run dev`; `npm --prefix atlas run shoot-backdrop -- --out=dir [--sc=0,1,2|all] [--only=desktop|phone] [--painted] [--rm]` screenshots every beat (3 record sieges, plus scenarios.json with `--sc=all`) and probes frame times.
