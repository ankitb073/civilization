# PRFAQ: Runner of the Tablet House

Draft for review, 2026-10-16. This is the first step of PRFAQ → HLD → LLD → code. The architecture is in [`hld.md`](hld.md).

## Press release

**Run the roofs of Pumi in the week it burns. Palimpsest's first open-city game puts you in the streets of a real siege from its record, on your phone, in your browser.**

Palimpsest today opens *Runner of the Tablet House*, a third-person game that runs in the browser on a phone or a computer. You are the runner of the palace tablet house of Pumi, a Bronze Age capital of about 20,800 people. It is AY 332, and the army of the great queen of Yida is coming.

For five days you carry clay through the city: the tokens of the levy, the news from the field, the roll of the dead, the tallies the king wants burned. You can take the streets or the roofs. Pumi's mud-brick houses have flat roofs and stand in courtyard blocks, so a runner who knows the city, and where the planks lie across the lanes, can cross most of it without touching the ground.

Everything you meet comes from the record.
- **The city** is the same model as `#/city/set:17` at that year. It has courtyard blocks, red roofs, the river Nudhnavbu through the town, walls standing since AY 234, the palace, and the columned temple of Jinru.
- **The people** carry the names of Pumi's own people at the time.
  - The king is Panshelon. He is nineteen and led the levy himself.
  - The enemy is Shenshetkuth, great queen of Yida, aged sixty-eight.
- **The prices.** The weigher in the market asks the record's price: about 9.25 grams of silver for a measure of grain, against about 6 a decade earlier.
- **The gods.** The priestesses serve the record's gods: Vinba of the earth, Eva of fire, and Yenan, who counts the nights.
- **The errands** follow that week's events:
  - the levy marching out for Rela;
  - the Battle of Rile, lost on the 28th day of Nurnin;
  - the walls;
  - the night of the 9th of Ani, when the enemy came in and the house of tablets burned;
  - the Treaty of Himi.

You cannot save Pumi; the ending is the record's. What you decide is smaller and closer: where you carry things, and what you say when you arrive.
- You can take the roll of the dead to the temple, to the steward, or to the dyer whose son is missing.
- You can tell the steward the count the runners brought, or the count the king wants.
- On the night of the sack you choose which baskets of tablets go into the fire, which into the cistern, and which you carry over the roofs. Fire bakes unfired clay hard; water unmakes it.

At the end, as in *The Tablet House*, your tablets are set beside the record, and an archaeologist of AY 49xx writes what was found.

The game is built from what the site already has:
- the city generator;
- The Tablet House's fact-checked script for Pumi, with its procedural sound and painted plates;
- an eyewitness account that survives in the archive, *The Burning of the House of Tablets at Pumi* (PAL·CH·08471). Its anonymous scribe watched the fire "from the roof of the house of tablets."

Tap the king, a god, a place, a price or a date in the game and its page in the archive opens. The townspeople carry real names of the city's people, though not people with pages of their own.

A playthrough takes 30 to 40 minutes. It is made for a mid-range phone: sound stays off until you tap it, and reduced motion is respected. There is nothing to install and no account. It is free and open source. More cities will follow: eleven of the Tablet House's thirty are Bronze Age towns with flat roofs.

> "I ran the length of Pumi over the roofs to get the count to the palace before the rumour did. Then I stood in the market while the weigher put nine weights of silver on the pan for one measure of grain. Afterwards I read the scribe's account of the fire and knew the street." (target player reaction)

## FAQ for players and readers

**Who is it for?**
- **Players** who like how Assassin's Creed, Mirror's Edge or Spider-Man move, but want something short, on a phone, with no install.
- **Readers of the archive** who want to stand in a city they have read about and see the record from the street.
- **Players of The Tablet House:** the same week, now on foot.
- **Not for** anyone after combat, driving, loot or a forty-hour world.

**What do I do, minute to minute?**
- **The loop:**
  1. Take something: clay, a basket of tokens, a sealed message.
  2. Run through the streets or over the roofs.
  3. Arrive and choose who gets it and what you say.
  4. See what follows: the meters move, the city reacts, the master scribe presses the tablet.
- **Between errands** you can go anywhere inside the walls. There are about twelve errands over the five days.

| Day | The record | The runner's work |
|---|---|---|
| 1, dawn | The levy of Duvekopuvinga marches for Rela | Hand out the clay tokens at the gate; carry the muster count to the palace |
| 2, noon to dusk | The Battle of Rile is lost: 5,129 against 11,288; 750 and 818 dead | Meet the barefoot runner at the gate; beat the rumour to the palace; the wounded come in |
| 3, evening | Siege; grain is dear | The weigher's scale; messages along the walls; the roll of the dead |
| 4, night | The sack on the 9th of Ani; the archive burns | The tablets to the fire, the cistern or the road; out over the roofs |
| 5, morning | The Treaty of Himi: 25 districts, 36 talents of silver a year for 29 years, a ten-year truce | Carry the terms; hear the king's version; the reckoning |

**How is it like GTA or Spider-Man?**
- **It borrows the feel, not the scale:**
  - a third-person camera;
  - a whole city you can go anywhere in;
  - movement that is a pleasure in itself, with roofs instead of webs;
  - streets that change with the day;
  - errands from people with names.
- **It leaves out** guns, killing, cars, police, a map the size of a county, and a hundred hours.

**Why the roofs?**
- **The city has them.** Bronze Age mud-brick towns had flat roofs that people lived on, and the model of Pumi draws exactly that.
  - Houses stand in courtyard blocks, a stride or two apart.
  - The streets between blocks are too wide to jump: climb down, or lay a plank.
- **Runners are already in the record's voice.**
  - The eyewitness writes "the runners told it. The runners wept as they told it."
  - On day four of the Tablet House script for Pumi, the king leaves "a runner to see it done."

**What is new here?** We scanned browser games, procedural-city games and history games; the closest are below.

| What exists | Examples | What it lacks for this |
|---|---|---|
| 3D worlds in a phone browser | *Messenger* (abeto, 2025: a mail carrier on a tiny planet, plays on phones); Bruno Simon's folio-2025 (three.js, Rapier) | Handcrafted; no simulation, no history |
| Traversal in a browser | *SWING NYC* (2026: web-swinging through a procedural voxel Manhattan, with touch controls). We found no third-person rooftop parkour in three.js. | Nothing in the city to learn |
| The runner, parkour through history | *Mirror's Edge* (a courier, "flight more than fight"); *Assassin's Creed* and its combat-free Discovery Tour | Authored; big budgets; console and PC |
| Walking a generated history | *Dwarf Fortress* adventure mode (graphical, 2025): ask people about the rumours and events of a simulated world | Top-down tiles on desktop; the history surfaces as logs |
| Generated cities and citizens | *Shadows of Doubt*, *Watch Dogs: Legion*, *Veloren*; *Ultima Ratio Regum* (ASCII, still in development) | No deep history, or no 3D streets; none in a browser |
| Living through fixed history | *Through the Darkest of Times*, *Pathologic 2*, *Pentiment*; *This War of Mine* (civilians in a siege) | Real or authored history; not an open city |

**So every ingredient exists, but we found nothing that combines a simulated history with a 3D city at street level in a browser.** What would be new:
1. **You are walking inside a primary source.** Every name, price, god and date, and the ending, come from a record that exists outside the game. You can open it and check.
2. **It runs on a phone,** in 3D, at street level.
3. **A Bronze Age city at street level.** We found none, though the search was not exhaustive.
4. **You choose with your feet.** Your choices decide what survives, and are then judged against the record.

Parkour, the messenger, the civilian siege and procedural history are not new on their own.

**What we took from the prior art:**
- **Introversion's Subversion** was shelved in 2011 because the tech ate the game. So every step of the plan ends playable.
- **Dwarf Fortress** shows that generated history tends to surface as clutter. So the record here speaks through a few people and places, with links for those who want more.
- **Players cannot tell "from the record" from "authored"** unless the game shows them. So everything from the record (its people, places, gods, prices and dates) links to its page.

**What is it not?**
- No weapons in your hands, no killing, no fights.
- No driving, riding or vehicles.
- No realism: it is stylised low-poly like the city models, and people look like the site's figurines (painted wood, no faces).
- Not a big world: one walled town of about 300 compounds, roughly 250–300 m across.
- Not alternate history: the city falls on the record's night.
- No voice acting, no multiplayer, no account, no store.
- **Not now:** a third city, interiors beyond the tablet house, combat, horses, swimming, and the pitched roofs of the Iron Age and after.

**What is it called?**
1. ***Runner of the Tablet House*** (recommended).
   - It says who you are and ties the game to The Tablet House, which players already know.
   - The Play hub tile can say "Runner"; each city is a subtitle: *Pumi, AY 332*.
2. *Tablet Runner.* Short and postable, and we found no game by that name. But "tablet" reads as the device, and it echoes *Blade Runner*.
3. *Pour Water for the Tablets.* The last line of the eyewitness account: moving once you have played, opaque before.

**Why Pumi first?** It is the Sack of Himi, AY 332 (`sc-919`).
- **The simplest roofs.** Its age in the city model is mud-brick and reed, with flat roofs, so the first traversal kit is the easiest: no slopes. Eleven of the thirty scenarios share that kit.
- **Its story is about the tablet house itself.**
  - The record says the archive burned.
  - The archive holds the eyewitness account by a scribe of that house who watched from its roof, and the enemy's own letter, *Tidings of Pumi: A Dispatch from the Queen's Tent*.
  - The Tablet House script for Pumi, *Until the Tokens Come Home*, already has the tokens, the roll of the dead, the cistern and a runner.
- **A legible cast.** A nineteen-year-old king who led his levy against an army twice its size; a great queen of sixty-eight; a mother whose levies he has to live up to.
- **A lie to catch.** The surviving chronicle (PAL·CH·00074, written six years later) gives 199 of ours dead and 1,312 of theirs. The record says 750 and 818.
- **A price to feel.** Grain cost about 6 grams of silver a measure in the 320s and about 9.25 in the 330s.
- **The right size.** About 300 buildings: enough to fill the screen at street level, small enough for a phone. It has a river with bridges, walls, a palace, a temple and a square, and no harbour to handle.
- **Passed over:**
  - Poyonga, AY 63: a harbour, and a chronicle that survives only as a fragment.
  - Nodoruegeremo, AY 2234: Iron Age gabled roofs.
  - Birnathu, AY 1840: a port, and no flagship.
  - Kagün, AY 1727: ends in a treaty; a good second city.

## Hard questions

**Will it run on a phone?**
- **We don't know yet;** step 1 measures it on a real device.
- **Reasons to expect yes:**
  - The city model draws Pumi's 300 houses in about a dozen draw calls. On desktop it builds in 5–7 ms and renders in 0.3 ms.
  - Collision can run without a physics engine. Step 1 weighs that against the spike's Rapier.
  - Crowds are instanced, not skinned.
  - Shadows render once a day.
  - Sound is synthesised, so there are no audio files.
- **The budget:**
  - a 30 fps floor on a Galaxy A54-class phone, and 60 fps on an iPhone 12 or newer;
  - at most 1.5 MB downloaded before the first step.
- **The risks** are heat over a 30-minute session on mid-range Android, and Safari's memory limits.
- **If the budget fails,** we cut the number of people on screen and the resolution before we cut the city.

**Who owns the assets?**
- **Code libraries** are MIT: three.js, three-mesh-bvh, recast-navigation-js, nipplejs. Rapier is Apache-2.0, and comes in only if step 1 picks it.
- **Characters** come from CC0 packs only, reshaped in Blender into the figurine look:
  - Quaternius's Universal Animation Library 1 and 2 for walking, running, jumping and carrying;
  - Mesh2Motion for climbing, hanging and ladders;
  - perhaps $25 of Quaternius's paid tiers for a matching climbing set. Those are also CC0.
  - No free source has a pull-up or a ledge shimmy, so those are keyed by hand.
- **Mixamo** is free to use in a game, but Adobe's terms forbid distributing its raw files.
  - Committing them to a public MIT repo would do exactly that.
  - Shipping them inside the web build is allowed game use, but anyone can save the files from the browser.
  - So no Mixamo files go into either.
- **The city and the sound** are generated by code in this repo.
- **The painted plates** were made locally with an Apache-2.0 model (decision 0029).
- Every asset folder records its source and licence.

**How do we stop scope creep?**
- The request said "like GTA", and the word pulls toward guns, cars and size.
- **The guardrails:**
  - one city, five days, about twelve errands;
  - the not-now list above;
  - eight steps, each playable and reviewed in one sitting before the next begins;
  - the second city added as content only, with no new code, to prove the pipeline.
- If a step overruns, we cut its features, not its review.

**How is violence in the sack handled?** The record says Pumi was sacked and its archive burned, and the eyewitness saw the enemy take "the young men with cords on their hands." The game does not look away from the fact, and does not make a spectacle of it.
- **You never hold a weapon** and never hurt anyone.
- **Soldiers are a danger to avoid,** not to fight.
  - If they catch you, the screen fades and a line tells what happened ("They took the basket. They let you go at dawn.").
  - The night resumes at the last checkpoint. There is no death animation.
- **No blood and no bodies on screen.** The dead are what they are in the archive: counts on tablets and names on a roll.
- **Shown in full:** fire, smoke, the drums that stop, people running, goods carried off, and the burned square in the morning. The eyewitness tells it the same way: looms stripped and goats taken, not wounds.
- **No child is shown in danger.**
- **A content note** comes before day four, with an option to skip the chase and keep the story.
- **Precedents:**
  - This War of Mine gives violence a lasting cost instead of a show.
  - Attentat 1942 tells reprisals through testimony and aftermath.
  - Valiant Hearts tells a war with almost no shooting.
- **The aim** is something a museum could show a twelve-year-old.

**What is from the record, and what is invented?**
- **From the record:** names, ages, titles, gods, the faith's teaching, prices by decade, the battle and its dead, the dates, the outcome, the treaty, and the chronicle's claims.
- **From the scripts** (agent-written and checked): the runner's household, the master scribe, the dyer, the steward, and what people say.
- **Added by the streets layer:** rooms, ladders, stalls, planks, and the gates the eyewitness names.
- **No invented siege price.** The record prices grain by decade, not by day, so the game shows the decade's price, as the Tablet House script does.

**Does it change the record or the archive?**
- No simulation or language change and no new catalogue numbers, so the flagships are safe.
- It may add fields to the scenarios export: the market's prices for the decade, more names, and the ids of documents about the siege. These go through the export contract and are recounted by the scenario test.
- Each city's streets script is checked like the Tablet House scripts: every figure is a placeholder filled from the record.

**How will we know it works?**
- **Each step measures** frame times, load time, memory and bot routes, and ends with the user playing it on a phone and a desktop.
- **After launch** the site has no analytics, so completion and return visits cannot be counted. Whether to add privacy-respecting counts is a decision to take.
- **The test that matters for the archive** is whether players open the eyewitness account or Pumi's page afterwards.

**What does it cost, and why not more cities at once?**
- **Money:** almost nothing. The libraries are free, Blender and ComfyUI run locally, and GitHub Pages hosts it.
- **Time:** eight steps.
- **Why one city:** each city needs a streets script, written and checked, and each age needs its own roofs. The eleven Bronze Age scenarios share Pumi's flat roofs; sloped roofs are a later decision.
