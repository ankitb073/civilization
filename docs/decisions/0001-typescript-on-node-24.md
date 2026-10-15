# 0001: TypeScript run directly on Node 24, with node:sqlite

**Context.** The engine needs speed (millions of cell updates), a local database, and types shared with the web atlas.

**Decision.**
- Write engine and atlas in TypeScript.
- Run the engine with Node 24's native type stripping, with no compile step.
- Store data with the built-in `node:sqlite`.
- Use only erasable syntax: no enums, no namespaces.

**Why.**
- One language end to end.
- The contract (`engine/src/export/contract.ts`) is imported by both sides, so engine and atlas cannot drift apart.
- V8 runs 5,000 years in about 10 s, where CPython would take minutes.
- There are no native modules to install, so a fresh clone and CI just work.
