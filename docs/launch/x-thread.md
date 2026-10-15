# Launch thread (draft)

Numbers refer to the canonical build (seed 5). Refresh them from `atlas/public/data/meta.json` before posting. Attach images from `docs/img/`.

---

**1/** I built an archive of a civilization that never existed.

5,000 years. ~2,000 states. ~5,000 wars. ~16,000 surviving documents: treaties, merchant ledgers, royal inscriptions, rival chronicles. Every one of them is checked against the "true" history.

[video: docs/img/borders.mp4]

**2/** It starts from one number (a seed). The world is simulated century by century: rivers and rain shadows, harvests and famines, volcanic winters, plagues along trade routes, debased coins, schisms, revolutions, first contact across an ocean.

Everything is stored in a SQLite database: about 200k border changes and 1M market prices.

**3/** Then it writes the documents that world would leave behind.

A treaty cedes exactly the districts the map shows changing hands. A merchant's ledger prices grain from the simulated harvest. A victory stele claims 6× the enemy dead the battle record shows.

[image: docs/img/inscription.png]

**4/** The languages evolve by real sound laws.

The oldest city was founded as *Lenunushal*. It became *Lenonoshal*, then *Lienunushal*, and today it is *Linnshal*, the way Londinium became London. A neighbouring people borrowed the name as *Lenunushalu*. The atlas shows every dated sound change in between.

Inscriptions come with transliteration, interlinear gloss and translation, all generated from the same sentence.

**5/** My favourite part: rival chronicles.

Each side's historian writes the same war. Each lies in its own way: blame flipped, defeats omitted, losses shrunk, territory "returned". Put them side by side with what actually happened.

[image: docs/img/compare.png]

**6/** Then the world's own modern scholars argue about the sources.

> "Each scribe told the truth exactly where his court could afford it."

(~240 flagship documents, from epic fragments to journal articles, are written by AI agents from database dossiers and validated by the same checker.)

[image: docs/img/poem.png]

**7/** The checker reads only the database. It verifies 14 invariants across ~1.8M facts:
- no document mentions anything that didn't exist yet
- every ceded district changes hands on the treaty date
- every author was alive and of age
- ledger prices match the market series

Zero violations. CI fails the build otherwise.

**8/** 5,000 years of power on one page: a Histomap, in the spirit of the famous 1931 chart.

[image: docs/img/histomap.png]

**9/** Atlas: [ankitb073.github.io/civilization](https://ankitb073.github.io/civilization). Map with time slider, a graph of every entity and event, a reader for every document. You can download the SQLite database and an Obsidian vault.

Code (MIT): [github.com/ankitb073/civilization](https://github.com/ankitb073/civilization)
