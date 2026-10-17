# 0032: The first errand: day one's muster, run to the river gate before a horn set from measured runs

**Context.** Steps 1–2 of *Runner of the Tablet House* (0030, 0031) made Pumi walkable on a phone. Step 3 makes one
errand playable end to end, so the loop (take, run, arrive, see what follows) can be judged before the other days are
built. This brings the HLD's errand step forward as a vertical slice. The errand had to be a bridge to *The Tablet
House* (0028): the same week, the same choice, the same numbers.

**Decision.**
- **The errand.** Day one, the muster.
  - **The start.** At the door of the house of tablets, the overseer (`{names.m.0}`, not a Tablet House character)
    gives the runner soft clay.
  - **The choice.** The runner presses one of the three readings of the Tablet House's own day-one `muster` slot:
    - the labels and lines are imported from `scenario-scripts/sc-919.json`;
    - the figure is the Tablet House engine's (`valuesOf`, `lineOf`): the record's `battle.ours`, rounded, or
      boasted;
    - it is pressed wedge by wedge on the Tablet House's clay tablet (`tablet/clay.ts`).
  - **The run.** The tablet goes to the levy at the river gate before the horn.
  - **The arrival, in time.** The commander (`battle.commander`, here the king, aged 19) has it read aloud and
    answers the reading.
  - **The arrival, late.** The levy has marched, and the gatekeeper (`{names.m.2}`) takes the tablet.
  - **The end card.** The time, the route as street and roof shares, the figure pressed against the record's figure,
    and a teaser for day two. It offers "Run it again" and "Back to the city".
  - **The runner's record.** The best time in time and the last pick are saved in `localStorage`
    (`pal-streets-errands-v1`, inside try/catch).
- **The gate: the river gate.**
  - It is a name from the record: the eyewitness account (fl-354) names it.
  - It is the Tablet House script's "canal gate" (0031), where the oxen low on day one and the wounded come in on day
    two.
  - It is the longest street route from the house of tablets: 203 m.
  - **Caveat:** on the map, Rela lies due south of Pumi, and the south gate faces it within 9°. Nothing in the record
    says which gate the levy used.
- **The horn: 50 seconds, from measured runs.**
  - **How it was measured.** Bot runs in fixed 60 Hz steps, from the door into the gate's radius
    (`streets-errand.ts`, measure pass):
    - the streets at a run: 29.8 s;
    - at a jog: 54.5 s;
    - at a walk: 127 s;
    - the crow's line over the roofs with the phone's auto-parkour: 33.9 s, 16% of it on roofs.
  - **What 50 s does.** A run through the streets makes the horn with 20 s to spare. A jog through the streets misses
    it by 4.5 s.
  - **Why not 2–3 minutes,** as first asked: at that length a walker would make it.
  - **The roofs are not faster in Pumi.** The street route is only 7% longer than the crow's line, and every street
    crossed on the roofs costs a drop and a climb.
  - **The validator checks this.** The streets at a run must beat the horn, and a jog that also beats it draws a
    warning. The playthrough re-measures the route and flags drift over 12%.
- **The script format: `streets-scripts/<id>.json`,** bundled like the Tablet House scripts.
  - **What it holds.** Per errand:
    - the people: name placeholders and roles;
    - `from` and `to`, as keys of `world/names.ts`;
    - the horn and the runs it was measured from;
    - the brief, the prompt, the overseer's word on each reading, the hand-over and the objective;
    - the arrival in time and late, with a line for each reading;
    - the end card's lines and the teaser.
  - **Placeholders.** Every record fact is a `{path}` of the scenario. The game fills `{value}`, `{tablet.line}`,
    `{place.to}`, `{place.from}` and `{<person>.name}`.
  - **The validator: `engine/src/debug/streets-validate.ts`,** separate from the Tablet House's, which is unchanged.
    - The Tablet House's prose rules: placeholders resolve, no digits in prose, record names come from placeholders.
    - `{value}` and `{tablet.line}` appear only after the pick.
    - Every place an errand names exists in the world, and no prose names a gate or street the world lacks.
    - The errand's people are not Tablet House characters.
    - The slot exists with three readings.
    - The horn is consistent with its measured runs.
  - **The test.** `engine/test/streets.test.ts` plays every reading, in time and late, headless.
- **The runtime (`atlas/src/game/streets/errand/`).**
  - `engine.ts` is a pure state machine: brief, choose, pressed, run, arrive, end.
  - **The clock.** The horn counts in the game's fixed-step clock, so slow frames and a hidden tab do not eat the
    runner's time.
  - **Roofs and streets.** Feet more than 2 m above the ground, and not over water, count as roof.
  - **The levy.** Painted-wood figurines in the state's banner colours: 79 on a computer, 55 on a phone. They are
    merged into a few meshes, which cost 6 draw calls (shadows included) and 48k triangles on a phone; they take
    7–9 ms to build. They have spears, sashes and shields; the commander wears a bronze helmet and a cloak. A
    standard carries the state's arms.
    - At the horn they march out through the gate.
    - Seen from far off, or with reduced motion, they are simply gone.
  - **Dialogues.** The runner stands still and keys reach the panel's buttons. The view turns to whoever speaks.
  - **The probes.** `#/streets?errand=0` leaves the city free; `streets.ts` and `streets-world.ts` use it.
- **Sound (`streets/sound.ts`).** It uses the same procedural soundscape:
  - the beats: `tablet` in the house, then `muster` with its intensity rising as the horn nears, then `ending`;
  - the one-shots: the stylus for each wedge, the seal, and the door;
  - the horn: a call synthesised by the soundscape's own `dsp.horn`, about 6 dB over the bed.

**Why.**
- **The bridge is the choice.** It uses the same three readings and the same bent figures as the Tablet House, and
  it ends with the same comparison against the record. Nothing is retyped, so neither game can drift from the other.
- **Evidence over the brief.** The horn and the honest finding about the roofs come from measured runs, not from the
  first guess. The measurements live in the script, where the validator checks them.
- **It plays on a phone.** Measured on a phone emulated at 4× CPU throttle over a real 31 s run of the route:
  - 60 fps, with a median and p95 frame of 16.7 ms and one or two frames over 20 ms;
  - 62 draw calls and 216k triangles on the way, and 62 calls and 226k triangles at the gate with the levy;
  - axe finds no violations in any panel.
  The errand completes with reduced motion, and with sound on or off.
