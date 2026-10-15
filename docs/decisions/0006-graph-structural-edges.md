# 0006: The graph uses structural edges, laid out at build time

**Context.** The archive has about 100k pages and about 800k body links. Drawing every body link makes the graph a hairball and a multi-megabyte download.

**Decision.**
- The graph includes *every* page as a node. Edges are structural only:
  - infobox relations: participants, author, polity, capital, language, parents;
  - up to 12 links per document.
- Positions are precomputed with ForceAtlas2, seeded by date so time flows left to right.
- Live physics is available in the browser.

**Why.**
- Every entity and event is present, as the brief asks.
- The picture stays legible and loads in a few megabytes.
