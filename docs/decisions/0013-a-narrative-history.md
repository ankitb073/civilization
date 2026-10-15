# 0013: A narrative History as the way in

**Context.** By wave 4 the archive held about 18,000 documents and 600 flagships. A new reader still had no place to start. The Story view gives seven ages in a few beats each. Documents make sense only once you know who the great powers were. The essays assume that knowledge.

**Decision.**
- Wave 5 (`buildHistory`, `engine/src/flagships/history.ts`) writes 21 dossiers: an introduction ("How we know what we know") and twenty chapters of 250 years each (fl-900–920).
- Each chapter dossier digests its period from the record:
  - population under states, and the number of states;
  - the great powers by peak population, with their long reigns;
  - foundings and collapses, and the deadliest wars with the sources that survive about them;
  - famines, plagues, eruptions and droughts;
  - faiths by share of the land;
  - first adoptions of technologies, and grain prices;
  - languages that split, and dated sound laws;
  - surviving documents by kind, with catalogue numbers to cite.
- Each chapter is written by a different modern scholar in AY 4999. The whole past is known, so chapters may look ahead.
- The `history` collection lists the chapters first. The atlas presents them as a book, with previous and next links and reading progress.

**Why.**
- Readers come for a story and stay for the sources. The History is the story; its citations by catalogue number send readers into the archive.
- It is still checked like any other flagship: whitelisted links, dates, and pronouns from the record.
