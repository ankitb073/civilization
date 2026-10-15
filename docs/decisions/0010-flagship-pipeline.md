# 0010: Flagship documents come from dossiers, and the simulation is frozen around them

**Context.** Procedural documents are consistent but formulaic. Agent-written prose is rich but can contradict the record or mention the future.

**Decision.**
- `npm run` of `engine/src/cli/dossiers.ts` builds one dossier per turning point. A dossier holds:
  - the subject facts, *cut at the document's date*;
  - a real, living author with a stance;
  - the local date, language and script;
  - a whitelist of linkable entities that already existed.
- Agents write `flagships/<id>.md`.
- Ingestion re-validates authors, dates and every link, and turns invalid links into plain text. It rejects any flagship whose `world:` fingerprint doesn't match the simulated world.
- The checker then audits the result like any other document.

**Consequence.** Flagships reference simulation ids. Any change to `engine/src/sim/**` alters ids. After such a change, regenerate the dossiers and rewrite or revalidate the flagships. Archive-level changes are safe.
