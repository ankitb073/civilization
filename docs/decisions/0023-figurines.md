# 0023: Figurines, the people of the record as painted game pieces

**Context.** Recurring characters (a queen in her Life, on her page, on a card, in a chronicle) had a seal (0021) but no body. Readers asked for them to look the same everywhere. A portrait would invent a face the record never gave, so the piece has to be stylised, and every visible choice has to come from the record.

**Decision.**
- **One builder, `buildFigure(person)` (`atlas/src/three/figure/build.ts`).** It reads a person's page (`spec.ts`: the Born, Died, People, House and Roles rows, and the seal) into a three.js group: a painted wooden piece on a turned base. It is deterministic; the only chance is a hash of the id (hair colour), and the cut of the hem comes from a hash of their people.
  - **Body.** Sex comes from the record (shoulders, waist, a gown). Age comes from the year the piece shows them, by default the middle of the role their seal is cut for. A child is small and big-headed; hair is grey from 60 and white from 75; a stoop from 62. There are no faces: a head of bare wood.
  - **Dress by the age of their prime.** Kilts and sheath gowns in the Bronze Age; tunics and cloaks; long robes; cotes, hose and veils; doublets, ruffs and farthingales; frock coats and uniforms; suits.
  - **Colours from the seal** (read from `heraldry.ts`'s own SVG, so they cannot drift). A member of a ruling house wears the house's quarters per pale and counterchanged. Anyone else wears the state's colour, trimmed in its metal, never metal on metal.
  - **Props by role.** A ruler has a crown by the age and a sceptre; a usurper adds a drawn sword, and a rebel who took the throne carries the banner of the broken chain. A regent holds the seal of state in both hands and wears the keys. A general has a helmet by the age, a shield painted with the seal up to the Age of Parchment, and a spear, sword or rifle. A scribe holds a tablet, scroll or book; a merchant scales, with a purse or a ledger; a priest a staff and censer; a prophet a star-topped staff. An envoy carries a letter sealed in the state's colour, an inventor tools by the age, an archaeologist a trowel and brush. A president has a charter and a sash; a chairman a torch (the seal's charge).
  - **Death.** A black armband marks someone who fell in battle; a black cloth over the base, someone executed.
  - **Base.** The material is the age's (sandstone, basalt, marble, oak, walnut with gilt, black lacquer with brass, concrete). The name and dates are printed round it in the letters of the age, and the seal is set into its top.
- **Where it shows.**
  - "View as a figure" on every person's page (`#/p/per:N?figure=1` opens it): a turntable with the reasons, line by line, and a PNG download.
  - `#/figures`: a shelf of the hundred subjects of the Lives in order of birth. `?house=dyn:N` shows a house's rulers in order of reign, `?ids=per:1,per:2@580` any people (`@year` shows a child king at his accession), and `?sel=` picks a piece.
  - `npm --prefix atlas run figures` renders a 512×512 transparent portrait of each Lives subject into `dist/s/fig/per-N.png`, with `index.json`, for cards and reading pages.
- **Data.** `figures.json` (about 34 KB, 7.5 KB gzipped) lists each Life with its subject's page, cut to the five rows a figure is built from, so the shelf doesn't fetch a hundred page shards.
- **Cost.** All of it is lazy: the dialog chunk is 25 KB gzipped plus the shared three.js chunk. One piece is three merged meshes plus its printed band and seal.

**Why.** The pieces carry what the record knows (sex, age, rank, house, age of the world, how a life ended) at a glance, and the same person is the same piece everywhere. The portrait script checks that every piece built from `figures.json` matches the one built from the person's own page, fingerprinting every vertex and colour.
