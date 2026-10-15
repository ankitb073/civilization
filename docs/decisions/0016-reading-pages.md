# 0016: Static reading pages for the flagships

**Context.** The atlas is a single-page app with hash routes (`#/p/art:36380`). Hash routes can't carry a per-document social card, and search engines see one page. The first share pages (`s/art-N.html`) fixed the cards with a stub that redirected at once to the atlas. But the stub had no text, its file name used an internal id that shifts whenever the archive is regenerated (stage 1 of decision 0015 moved every id), and a reader on a phone waited for the whole atlas to load before seeing a word.

**Decision.** Every flagship gets a static reading page, `s/fl-NNN.html`, named by its frozen flagship id.
- The page holds the full text (the archive's Markdown rendered by the EPUB's renderer), the date in its own calendar, author and catalogue number, and the editorial note. It also carries Open Graph and Twitter cards with the period's map, and schema.org metadata.
- Every person, place and event links into the atlas. A button opens the document there, and previous/next links follow the reading order (the History by chapter, the Lives by birth, essays by number, sources by date).
- There is no redirect. The canonical URL is the page itself.
- `s/index.html` lists all of them by series, and `sitemap.xml` lists the atlas, the contents and every page. A `<noscript>` link in the atlas points crawlers at `s/`.
- The atlas's Share button shares a flagship's reading page (share sheet on phones, clipboard elsewhere), and the atlas link for anything else.

**Why.** Posts are where readers come from. A link should unfurl as a card, open in a fraction of a second on a phone, and stay valid after the next rebuild. Indexable full text gives the 656 literary documents a way to be found by search. The pages cost about 10 MB and no new dependencies.
