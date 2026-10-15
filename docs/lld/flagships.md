# LLD: Flagship sources (`engine/src/flagships/`, `flagships/`)

## Waves

| Ids | Wave | Builder | Authors |
|---|---|---|---|
| fl-001–190 | Turning points: wars, treaties, collapses, foundings, schisms, plagues, eruptions, revolutions, first contact, inventions, great reigns | `buildDossiers` | Participants alive at the date, or anonymous poets |
| fl-201–249 | Historiography: rival chronicles revisited, era surveys, language families, collapses, founders | `buildHistoriography` | The archive's modern scholars |
| fl-301–549 | Wave 2: sacks, sieges, debasements, conversions, persecutions, migrations, successions, usurpations, weddings, councils, bankruptcies, colonial and independence wars, reforms | `buildWave2` | As in wave 1 |
| fl-601–640 | *Lives*: long-form biographies of the 40 most consequential people | `buildLives` | Modern scholars |
| fl-701–807 | *Voices from below*: famines, plagues, sacks, migrations, debasements, conquests, colonies, revolutions, eruptions, droughts and wars, as ordinary people lived them | `buildVoices` | Anonymous: a farmer's wife, a conscript, an apprentice, a market woman, a refugee |
| fl-900–920 | *A History of the World*: an introduction and twenty chapters of 250 years (decision 0013) | `buildHistory` (`history.ts`) | Modern historians, AY 4999 |

## Dossier → document → ingestion

1. `node engine/src/cli/dossiers.ts 5 240 [--wave=2|3|4|5]` writes `build/dossiers/fl-NNN.json`. Each dossier has:
   - the form and register;
   - the document year and its **local date**;
   - the language and script;
   - an author (a simulation person, or a scholar, whose ids are stable) with sex and stance;
   - subject facts **cut at the document's date**;
   - context: ruler, faith with tenets, currency and grain price, recent events;
   - `allowedLinks`: entities that already existed, in their period form, with pronouns for people;
   - the binding guidance;
   - the frontmatter to copy, including the `world:` fingerprint.
2. Writer agents produce `flagships/fl-NNN.md`. Fact-checker agents then compare each document with its dossier and with `world.sqlite`. They fix contradictions, never true detail.
3. `ingestFlagships` (in `buildArchive`, after the procedural generators):
   - rejects a file whose `world:` fingerprint differs from the current world;
   - requires a valid year, title, polity, subject and language;
   - accepts the author only if they are alive and at least 12 at the date;
   - turns any link to a non-page, to a person not created by the simulation, or to something that did not yet exist into plain text;
   - maps the form to a document type (letter, chronicle, scripture, poem, diary, pamphlet, newspaper, paper, decree…);
   - dates the document in its culture's calendar;
   - marks it `flagship` (always extant).
4. The checker audits flagships like every other document.

## Stability

The fingerprint hashes simulation events only, so archive-level changes never invalidate flagships. Any change under `engine/src/sim/**` does; after one, regenerate the dossiers and rewrite or revalidate the flagships (decision 0010).
