# 0021: Clash of the Ages, a card game from the record, with procedural heraldry and personal seals

**Context.** The lying-chronicle game (0017) gives people a reason to come back each day, but it shows one kind of record: the wars both sides wrote down. Most of the archive's people and states are only names until you open their pages. A collectible card game turns them into objects you can hold side by side and compare. It also needs a face for every state and person, the same wherever they appear (cards, pages, Lives, video), and a flat list of names has none.

**Decision.**
- **A deck exported from the record (`deck.json`, `engine/src/export/deck.ts`):** 300 cards, made up of 100 rulers, 80 generals, 70 states, 26 cities and 24 faiths. Each card links to its page and carries four numbers, each a count or a maximum read straight from the record:
  - rulers: reign, wars won during the reign, districts gained, battles led;
  - generals: battles, victories, largest host, enemy losses;
  - states: peak extent, peak population, lifespan, wars won;
  - cities: peak population, years standing, years as a capital, sieges endured;
  - faiths: peak followers, years, states that made it their religion, conversions.

  Each stat carries a `how` string saying how it is counted, and the game shows these. `engine/test/deck.test.ts` counts them again independently, and each can be checked with one SQL query against `world.sqlite`.
- **Selection and rarity follow significance.** A card's score is its mean percentile rank across its four stats within its kind, plus half its page's backlink rank. Each age gets a share of the cards by the square root of its candidates, so the Bronze Age doesn't crowd out the Age of Engines. Rarity comes from the score: the top 6% are legendary, then 14% epic, 30% rare, and the rest common.
- **The game (`#/cards`, `atlas/src/views/CardsView.tsx`):**
  - **The deal.** Seven pairs of cards, each pair of one kind: two rulers, two generals, two states, and a city or a faith. The daily deal is seeded by the date; "Deal again" draws a random one.
  - **Play.** You pick a stat and the higher number wins. The archive's card back shows its kind and age, so knowing the ages is part of the skill.
  - **Scoring.** Four wins take the match, but the hand is played out to seven, so the score (5–2) and the share line (seven squares) say how well you did.
  - **Sharing.** The share text links to `s/cards.html`, a static page with its own social card.
  - **Gallery.** `#/cards/deck` shows the whole deck, and marks the cards you have met (stored in localStorage).
- **Heraldry is drawn atlas-side (`atlas/src/heraldry.ts`) from specs the engine reads from the record.** The specs are `ArmsSpec` and `SigilSpec` in the contract. They are attached to the pages as `arms` and `sigil` at export time, and to the cards. The drawing is a pure function of the spec; its only "chance" is a hash of the id.
  - **Arms.** The shield's shape is the age of the founding: round in the Bronze Age, a badge in the Age of Networks. The colour comes from the people, so a people's states share it. The metal comes from the state's first recorded faith, and the division from the id. The charge comes from what the state was: a tower for a city-state, a ship that changes with the age for a sea power, a crown, a fleur-de-lis or a lion for kingdoms, an imperial crown, eagle or orb for empires, a star for theocracies, a cogwheel for industrial republics, a horse for hordes, an anchor for colonies, a sword for rebels. Cities bear a castle (on a wavy base if a port), and faiths a vesica seal with a star, wheel, sun or crescent. The rule of tincture holds: charges that cross a division are counterchanged.
  - **Seals.** Men's seals are round and women's are lozenges. Members of a ruling house have a quartered field in their state's colour and metal; everyone else has a plain field within a bordure. The charge is for the highest role the person held: a crown for a ruler, crossed swords for a general, a wheel, press or cogwheel (by age) for an inventor, a scroll for a scribe, scales or a ship for a merchant, a star for a prophet, a broken chain for a rebel, a dove for an envoy, a label for an heir. The seal also bears their initial, in letters of their age.
  - The reader shows arms or a seal, small, at the head of the infobox on every state, city, faith and person page.

**Why.**
- **Credibility:** every number is checkable, and the game says how each is counted. A card game that invented "power ratings" would undercut an archive whose point is that everything is checked.
- **Habit and reach:** a daily deal with a shareable score, plus a deck to collect, are reasons to come back. Each card links to a page, so the game feeds readers into the archive.
- **Balance:** across 3,000 simulated deals, picking at random wins 45% of matches, and always picking the stat that ranks highest within the kind wins 93%. Knowing the record pays, and a beginner still has a fair chance.
- **One face everywhere:** the arms and seals are pure functions of record data shipped in the export, so a state or person looks the same on cards, pages and any future surface. Canon and the engine's RNG streams are untouched.
