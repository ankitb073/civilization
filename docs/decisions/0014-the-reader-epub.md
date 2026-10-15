# 0014: The Reader, an EPUB of the literary archive

**Context.** The atlas suits exploring, not long reading on a phone or e-reader. The vault (Obsidian) and the database download are for tinkerers.

**Decision.**
- `engine/src/export/book.ts` writes `downloads/palimpsest-reader.epub` on every full build. It contains:
  - the History;
  - the literary sources in date order, grouped by age and split into files of about 30 documents;
  - the Lives, then the scholars' essays;
  - the atlas's featured procedural documents as specimens.
- Every entity link points to its page in the online atlas.
- The EPUB is self-contained and deterministic: a fixed timestamp, entries in a fixed order, and a minimal zip writer (`node:zlib` deflate and `crc32`, with mimetype first and stored).
- A test checks the zip layout and that every XHTML file is well-formed.

**Why.**
- A book travels where a web app doesn't. It is the most shareable form of the writing.
- Links back to the atlas turn readers into visitors.
- No new dependencies.
