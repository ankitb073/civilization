# Launch thread (draft)

Numbers refer to the canonical build (seed 5). Refresh them from `atlas/public/data/meta.json` before posting. Attach images from `docs/img/` and `atlas/public/og/`. Share links to documents should use the share pages (`https://ankitb073.github.io/civilization/s/art-N.html`), so they unfurl as cards.

---

**1/** I built a 5,000-year archive of a civilization that never existed.

~2,000 states. ~5,000 wars. ~18,500 surviving documents: treaties, merchant ledgers, royal inscriptions, rival chronicles, omen tablets, customs tariffs, newspapers. Each one is checked against the "true" history.

[video: docs/img/borders.mp4]

**2/** It starts from one number, a seed. The world is simulated year by year: rivers and rain shadows, harvests and famines, volcanic winters, plagues along trade routes, debased coins, schisms, revolutions, and first contact across an ocean.

All of it goes into a SQLite database: about 200k border changes and 1M market prices.

**3/** Then it writes the documents that world would leave behind.

A treaty cedes exactly the districts the map shows changing hands. A merchant's ledger prices grain from the simulated harvest. A victory stele claims 5× the enemy dead the battle record shows.

[image: docs/img/inscription.png]

**4/** The languages evolve by real sound laws, and every change is dated.

Proto-Tasemem *kikweka*, "water", 3,200 years before the first city:
→ 'ikwe'a (glottalization, −2478)
→ 'igwe'e (voicing, AY 381)
→ yegwe (AY 1288) → yebe (AY 2112) → yiv (AY 4919) in Simem.

Back home in Tasemem the word was swapped out in AY 1509 for a borrowing, *usashi*, which wore down to *uash*.

The Word Machine traces 114 words through all 126 languages.

**5/** My favourite part is the rival chronicles.

Each side's historian writes up the same war, and each lies in its own way: blame flipped, defeats left out, losses shrunk, territory "returned". You can put them side by side with what actually happened.

[image: docs/img/compare.png]

**6/** Then the world's own scholars write its history: *A History of Yüvinzhi*, 21 chapters, ~60,000 words, citing ~300 surviving documents by catalogue number.

> "Men lie about the dead, but they seldom lie about the price of bread, and that is why this book reckons in grams of silver."

[image: atlas/public/og/ch06.jpg]

**7/** And ordinary people speak too: 107 "voices from below". A farmer's wife in the hungry year, a conscript's letter home, a market woman's tally of the light new coin.

> "The market is full of goats and nobody is buying, so a goat brings half what it brought and barley costs twice. You can do that sum in your head."

**8/** The checker reads only the database. It verifies 16 invariants across ~1.9M facts:
- no document mentions anything that didn't exist yet
- every ceded district changes hands on the treaty date
- every author was alive and of age
- ledger prices match the market series
- every catalogue number a document cites exists, and predates the citation

Zero violations. CI fails the build otherwise.

**9/** 5,000 years of power on one page: a Histomap, in the spirit of the famous 1931 chart.

[image: docs/img/histomap.png]

**10/** The atlas: [ankitb073.github.io/civilization](https://ankitb073.github.io/civilization)

It has a map with a time slider, a year view for any year, a graph of every entity and event, and a reader for every document. Take the whole book with you as an EPUB, or download the SQLite database or an Obsidian vault.

Code (MIT): [github.com/ankitb073/civilization](https://github.com/ankitb073/civilization)
