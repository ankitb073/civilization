# 0031: The streets layer adds street-level detail on the city model's plan, and the model wins over a script

**Context.** *Runner of the Tablet House* (0030) puts a runner at street level in Pumi, AY 332. The city model (0024) is drawn to be seen from above: it places houses, walls, the palace, the temple and the river by the record. At 1.7 m eye height it reads as flat primitives with no way onto the roofs. Two more questions came up:
- **Before the sack.** Days 1–3 happen before the sack, but the model draws a sacked year already burnt.
- **River or canal.** Pumi's Tablet House script (sc-919) describes a canal ringing the city, while the model has the river Nudhnavbu running through it.

**Decision.**
- **What the layer adds.** A deterministic streets layer (`atlas/src/game/streets/world/`), seeded from hashes of the city id, adds detail on the model's own footprints:
  - parapets, doors, windows and beam ends;
  - awnings, market stalls and jars;
  - stairs, 183 ladders, and planks over roof gaps;
  - shader materials (mud plaster, brick, flagstones, ruts);
  - burnt shells for sacked houses;
  - a flowing river with banks;
  - hearth smoke, the state's banners, birds and still figures.
- **What it may not do.** It never moves or adds a house, a wall or a public building. The streets' Pumi matches `#/city/set:17?y=331` lot for lot.
- **Before the sack.** `buildCity(…, { beforeSack: true })` is an option that is off by default and ignores a sack that falls in the drawn year. The streets view uses it unless the URL has `?sacked=1`. Every other view is unchanged, checked by instance fingerprints and by zero differing pixels on the city view and the Tablet House backdrop.
- **The model wins over a script.** Where a script contradicts the model, the model wins, because it is drawn from the record. The script's "canal gate" becomes the river gate.
- **Names.** Places take their names from the record (Temple of Jinru, the palace of Duvekopuvinga, the river Nudhnavbu) and from the city's surviving documents (the gate of the barley-merchants, from the eyewitness account fl-354). Otherwise they keep a generic name ("The market").
- **Navigation data.** Ladders, places and water depth are exposed to the runner through `affordances.ts`.

**Why.**
- **Consistency is the archive's promise.** The game must not contradict the city view, the record, or the documents a player can read.
- **Reachability is the traversal hook.** Every place can be reached on foot, and 223 of the 226 flat roofs can be reached.
- **Measured budget.** On a phone emulated at 4× CPU throttle, the city runs at 60 fps with 71–78 draw calls and 203–211k triangles, within the 100-call and 300k-triangle budgets.
- **The slow-4G load misses its target.** It takes 13.7 s against a 4 s budget, mostly Rapier, the city data and the runner model. Tracked as an issue.
