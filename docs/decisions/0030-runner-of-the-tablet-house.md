# 0030: Runner of the Tablet House, a third-person open-city game, built one playable step at a time

**Context.** The user asked for "an immersive game like GTA 5 or Spider-Man, not the scale", built from open-source parts, one step at a time. The site already has what such a game needs from the record:
- generated cities by year (0024);
- 30 sieges with fact-checked scripts (0028);
- a soundscape and painted art (0029).

What it lacks is a body in the street: a third-person character, collision, a camera and controls that feel good on a phone. That is also the biggest unknown.

**Decision.**
- **The game.** *Runner of the Tablet House* (working title), at `#/streets`. You are a runner of the palace tablet house in a real city during the week of its siege. You live the record's week at street level: the muster, the battle news, the siege, then the sack or the treaty. Rooftop running is the traversal hook. The look is stylized low-poly like the city models, not realism. There is no driving and no gunplay. Design: `docs/streets/prfaq.md` and `docs/streets/hld.md`, which hold eight steps, each ending playable.
- **First city: Pumi, AY 332 (sc-919).**
  - Flat mud-brick roofs.
  - Its tablet house burned, and an eyewitness watched from its roof (fl-354).
  - A 19-year-old king faces a great queen of 68.
  - Its chronicle's lie (199 dead against the record's 750) is there to catch.

  The movement spike runs in Nodoruegeremo, AY 2234 (sc-18225) until step 2.
- **Step 1, the movement spike (done):**
  - Rapier 0.19.3 (Apache-2.0) with its kinematic character controller.
  - A fixed 60 Hz step with an interpolated render.
  - Colliders derived from the city model's own parts.
  - A Quaternius CC0 runner (Universal Base Characters and Animation Library). Each gait's ground speed is measured from its clip, so the feet don't skate.
  - An over-the-shoulder camera that sweeps for collisions.
  - Controls: keyboard and mouse on desktop; a floating stick, drag-to-look and a jump button on phones.
- **Assets and licences.**
  - CC0 or permissive only; each asset's source, licence, commit and hash is listed in `atlas/public/game/streets/LICENSES.md`.
  - No Mixamo files: Adobe's terms forbid redistributing them.
  - Rapier's licence text ships with the build.

**Why.**
- **Retire the hardest risk first.** Step 1 measured what step 1 had to show:
  - **Frame rate:** 60 fps, median and p95 16.7 ms, on desktop and on a phone emulated at 4× CPU throttle. CPU 0.5–1.3 ms per frame, physics 0.1–0.4 ms. A 3.3-million-person city also held 60 fps.
  - **Feel:** a start to full run in 0.23 s, a stop in 0.83 m, and a held jump of 1.18 m.
  - **Not yet measured:** a real phone's GPU, which is step 2's first task.
- **Rapier for now, reviewed at step 2.** Its controller covered slopes, steps, snapping and sliding with no custom code. The cost is the download: 830 KB gzipped, against about 60 KB for three-mesh-bvh, which would mean writing our own controller. If the real-phone test shows load time hurts, step 2 switches.
- **Reuse.** The game reads the same scenarios, scripts, city model, soundscape and art as the Tablet House, so a new city is writing, not engineering.
