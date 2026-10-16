# Launch thread (draft)

Numbers refer to the canonical build (seed 5). Refresh them from `atlas/public/data/meta.json` before posting. Attach images from `docs/img/` and `atlas/public/og/`. Link documents by their reading pages (`https://ankitb073.github.io/civilization/s/fl-905.html`, the atlas's Share button gives the link), so they unfurl as cards and open fast on a phone.

---

**1/** I built a 5,000-year archive of a civilization that never existed.

~2,000 states. ~5,000 wars. ~18,500 surviving documents: treaties, merchant ledgers, royal inscriptions, rival chronicles, omen tablets, customs tariffs, newspapers. Each one is checked against the "true" history.

[video: docs/img/borders.mp4]

**2/** It starts from one number, a seed. The world is simulated year by year: rivers and rain shadows, harvests and famines, volcanic winters, plagues along trade routes, debased coins, schisms, revolutions, and first contact across an ocean.

All of it goes into a SQLite database: about 200k border changes and 1M market prices.

**3/** Then it writes the documents that world would leave behind.

A treaty cedes exactly the districts the map shows changing hands. A merchant's ledger prices grain from the simulated harvest. A victory stele claims about 5× the enemy dead the battle record shows.

The biggest boast: King Nambulame "killed 260,200 soldiers" at Khambive. The record has 37,907.

[image: docs/img/stele.png]

**4/** The languages evolve by real sound laws, and every change is dated.

Proto-Tasemem *kikweka*, "water", 3,200 years before the first city:
→ 'ikwe'a (debuccalization, k > ʔ, −2478)
→ 'igwe'e (voicing, AY 381)
→ yegwe (AY 1288) → yebe (AY 2112) → yiv (AY 4919) in Simem.

Back home in Tasemem the word was swapped out in AY 1486 for a borrowing, *usashi*, which wore down to *uash*.

The Word Machine traces 114 words through all 126 languages.

**5/** My favourite part is the rival chronicles.

Each side's historian writes up the same war, and each lies in its own way: blame flipped, defeats left out, losses shrunk, territory "returned". You can put them side by side with what actually happened.

The worst offender, the Tlayiyan account of the Third Nis Trade War, admits 15 of its 5,772 dead. The archive ranks them: ankitb073.github.io/civilization/s/c/spin.html

[image: docs/img/compare.png]

Or play it: five wars a day, two lying scribes each, guess the real death toll. ankitb073.github.io/civilization/s/game.html

**6/** Then the world's own scholars write its history: *A History of Yüvinzhi*, 21 chapters, ~60,000 words, citing ~300 surviving documents by catalogue number.

> "Men lie about the dead, but they seldom lie about the price of bread, and that is why this book reckons in grams of silver."

[image: atlas/public/og/ch06.jpg]

**7/** And ordinary people speak too: 107 "voices from below". A farmer's wife in the hungry year, a conscript's letter home, a market woman's tally of the light new coin.

> "The market is full of goats and nobody is buying, so a goat brings half what it brought and barley costs twice. You can do that sum in your head."

**8/** And a hundred Lives, not only of kings. A general of Tsey whose own chronicle names him only on the days he won. An envoy whose whole surviving voice is the last line of five treaties: "Drafted by Onivish." The man who built the first printing press. A merchant house that lasted 284 years, longer than any other in the record.

Each is checked claim by claim against the record. An independent audit of a random third found 2 minor errors in about 1,200 claims.

ankitb073.github.io/civilization/s/c/lives.html

**9/** The checker reads only the database. It verifies 19 invariants across ~1.97M facts:
- no document mentions anything that didn't exist yet
- every ceded district changes hands on the treaty date
- every author was alive and of age
- ledger prices match the market series
- every catalogue number a document cites exists, and predates the citation

Zero violations. CI fails the build otherwise.

**10/** 5,000 years of power on one page: a Histomap, in the spirit of the famous 1931 chart.

[image: docs/img/histomap.png]

**11/** The atlas: [ankitb073.github.io/civilization](https://ankitb073.github.io/civilization)

It has a map with a time slider, a year view for any year, a graph of every entity and event, and a reader for every document. Take the whole book with you as an EPUB, or download the SQLite database or an Obsidian vault.

Code (MIT): [github.com/ankitb073/civilization](https://github.com/ankitb073/civilization)
