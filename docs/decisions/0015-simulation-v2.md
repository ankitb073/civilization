# 0015: Simulation v2: men under arms, outcome-dependent losses, and acts dated inside their actors' lives

**Context.** Readers of the canonical world (seed 5, decision 0009) keep meeting impossible numbers. Six realism bugs and three P3 consistency bugs were filed against the simulation:
- **#16:** the winner loses more men than the loser in 63% of battles.
- **#1:** Bronze Age musters of 18 and 36 men; rebels start with about 33 men ("34 rebels against 1,414,318").
- **#6:** army *strength* (headcount × arms multiplier, up to ~10× by the industrial era) is reported as headcount ("92,604,163 men").
- **#9, #8, #7:** dead rulers sign treaties; conversions name a ruler from later in the decade; movements are founded by states that no longer exist.
- **#15:** coins predate coinage.
- **#17:** 471 states have no statistics row.

The world is frozen because 656 agent-written flagships quote it (decision 0010). So the fix was built on branch `sim-v2`, in two separable stages, and measured before anything merges.

**Decision.** Two commits on `sim-v2`, each with its own migration cost.

*Stage 1, `87a1671`: the record changes, the world does not.* Every simulated event, date, place, person and name stays identical. The world fingerprint is unchanged (`ef5abe84`), all 656 flagships are accepted, and the canon test passes unchanged.
- Polities keep a headcount (`soldiers`) apart from strength (#6). Battle sizes, casualties, war losses and `polity_years.army` count men.
- Every state musters `max(pop · mobilization, min(pop · 5%, 500))` men, from the day it is born (#1).
  - A rebellion raises 2% of its province, plus that province's share of the crown's men.
  - Losses are made good at a quarter of the gap a year.
- Casualties depend on the outcome (#16).
  - The beaten side loses 6–36% of the men it engaged, more in a rout.
  - The victor loses 1.5× (close fight) to 5× (rout) fewer, with log-normal scatter, capped at a quarter of its men.
  - Casualties are drawn from their own RNG stream, so no other draw moves.
- The record of rulers, polities and currencies is corrected:
  - Dead rulers do not sign (#9).
  - A conversion names the ruler of its own year, from a new reign history (#8).
  - A movement founded after its state fell is credited to whoever then held its birthplace (#7).
  - A currency is not issued before its tech (#15): a diffused tech's nominal in-decade date moves back to the issue.

*Stage 2, `112b19a`: men under arms drive the wars (a new world).*
- Strength is derived from headcount: `soldiers × arms of the age`, ×0.6 for rebel militia. Casualties wear it down; recruitment restores it.
- Weariness grows with the share of its levy a side has lost.
- Deaths are handled before anyone acts:
  - Heads of state who died are replaced at the start of each year.
  - A ruler who falls in battle is succeeded at once.
  - A dead ruler marries no one.
- Currency, religion and movement steps run after the political year loop, for states still standing, dated no earlier than their birth.
- A state that came and went between two surveys gets one stats row (#17).
- A fiat money worth less than 0.01 g is redenominated. This fixes a latent bug: ledgers priced at 0 g, seen on seeds 1 and 18.
- The canon pin moves to v2's languages (`a7b499ca`; main keeps `c5234467`). The language engine is untouched; the world's history simply coins different names.

*Archive, `b146c84`:* comparative-linguistics papers cite only languages spoken by their date. This is a latent no-anachronism failure exposed on seed 1. The archive is byte-identical on canonical v1, so the fix is safe for main.

Tools: `engine/src/debug/realism.ts <db…>` (every row below) and `engine/src/debug/flagship-drift.ts <before> <after>` (the stage-1 cost table).

**Measurements, seed 5** (built with `--no-downloads`; v1 = main at `ee2e0c8`).

| Measure | v1 | Stage 1 | Stage 2 (v2) |
|---|---|---|---|
| Battles in which the winner loses more men (#16) | 62.6% | 3.0% | 2.9% |
| Median loser/winner loss ratio | 0.51 | 3.23 | 3.15 |
| Routs in which the loser loses ≥ 3× the winner | 21.9% | 82.3% | 80.9% |
| Men per side, Bronze (< AY 1750): p5 / p50 / p95 | 28 / 2,514 / 16,987 | 384 / 3,057 / 17,276 | 333 / 2,710 / 14,649 |
| Iron (< 2350) | 28 / 5,587 / 38,064 | 458 / 4,397 / 23,061 | 515 / 4,050 / 22,550 |
| Classical (< 3200) | 28 / 13,696 / 84,131 | 857 / 8,351 / 43,287 | 1,082 / 8,830 / 42,865 |
| Medieval (< 4300) | 27 / 24,392 / 169,524 | 1,672 / 13,827 / 81,868 | 1,301 / 12,505 / 93,600 |
| Early modern (< 4760) | 27 / 55,100 / 630,101 | 1,882 / 21,841 / 192,364 | 1,758 / 24,820 / 179,859 |
| Industrial (< 4950) | 26 / 631,435 / 6,881,823 | 7,529 / 87,853 / 668,029 | 3,176 / 36,768 / 598,143 |
| Post-industrial | 29 / 2,841,978 / 29,933,458 | 6,658 / 246,863 / 2,169,514 | 7,164 / 104,912 / 1,049,763 |
| Battle sides under 100 men (#1) | 23.1% | 0.1% | 0.3% |
| Rebel armies p5 / p50; share under 300 men (#1) | 19 / 33; 72% | 459 / 4,377; 3.0% | 353 / 3,649; 3.4% |
| Smallest rebel army (vs crown) | 16 vs 2,488 | 81 vs 2,417 | 99 vs 660 |
| Polity-decades with an army over 6% of the people (#6) | 3.6% | 0.0% | 0.1% |
| Largest army recorded | 92.6 M | 6.9 M | 3.7 M |
| Winner had under half the loser's men | 7.1% | 10.3% | 8.6% |
| Independence / civil wars won by the rebels | 6% / 2% | 6% / 2% | 17% / 10% |
| Interstate wars declared on states under 10 years old | 34% | 34% | 9% |
| States / wars / collapses | 2,021 / 5,013 / 699 | same | 1,737 / 4,112 / 635 |
| Revolts / civil wars / conquests | 300 / 378 / 715 | same | 256 / 312 / 665 |
| World population AY 1000 / 2000 / 3000 / 4000 / 5000 (M) | 59 / 66 / 143 / 226 / 1,724 | same | 60 / 68 / 117 / 224 / 1,153 |
| Seed score (`scan.ts`; decision 0009) | 19.9 | same | 19.1 |
| #9 treaty signatories already dead | 180 of 8,488 | 0 | 0 |
| #8 conversions naming a ruler not in office | 62 of 380 | 0 | 0 |
| #7 movement foundings by an ended polity | 10 of 161 | 1 | 0 |
| #15 coins struck before their issuer knew coinage | 39 of 521 | 0 | 0 |
| #17 polities without a stats row | 471 of 2,021 | 471 | 0 |
| Conversions, persecutions, currencies by an ended polity | 68 of 1,628 | 68 | 0 |

**Spot checks, v1 → v2.** On every seed, every fixed-bug count goes to 0 and the checker passes.

| Seed | Winner loses more | Loss ratio | Sides < 100 men | Rebel p50 | States | Wars | Collapses | Pop. AY 1000 / 3000 / 5000 (M) |
|---|---|---|---|---|---|---|---|---|
| 18 | 61.5% → 3.0% | 0.56 → 3.20 | 22.5% → 0.0% | 34 → 4,189 | 2,215 → 1,884 | 5,441 → 4,255 | 754 → 655 | 66 / 125 / 1,376 → 66 / 130 / 1,300 |
| 25 | 61.9% → 3.0% | 0.55 → 3.18 | 21.5% → 0.1% | 33 → 4,995 | 2,183 → 1,743 | 5,406 → 3,999 | 774 → 649 | 74 / 104 / 1,670 → 75 / 116 / 1,290 |
| 1 | 65.1% → 2.9% | 0.46 → 3.17 | 23.2% → 0.0% | 33 → 4,578 | 2,077 → 1,799 | 4,962 → 4,015 | 693 → 613 | 75 / 132 / 1,942 → 74 / 145 / 1,318 |

**Reading the macro shifts.**
- *About 20% fewer wars and 15% fewer states.* In v1, a state born mid-decade had zero strength until the next decade, so a third of all interstate wars piled onto newborn states, and most of v1's "dissolved" wars were these pile-ons. In v2, newborn states have armies. Wars between established states rise by 12% (2,876 → 3,216), and the median state lives 62 years instead of 32.
- *Population in AY 5000 runs 5–33% lower.* This is mostly noise from industrial timing. In a six-seed run (5, 18, 25, 1, 7, 12), four variants of the weariness term spread the total from 7.4 to 9.4 bn, against v1's 9.1 bn and v2's 8.0 bn. The mean first-steam year moves from AY 4760 to 4773.
  - At AY 1000 and 4000, totals agree within 7%.
  - At AY 3000 they differ by −18% to +11%, with no consistent sign.

**Not fixed.** Houses, plagues, famines, inventions and script adoptions are still dated after their polity ended: 97 events on seed 5 under v2. These come from decadal steps that run before the year loop. The same class as #7, filed as #18.

**Migration cost.**
- *Full v2 (stage 2).* A new world: names, wars, states and catalogue all change. All 656 flagships are rejected and must be rewritten from regenerated dossiers (`node engine/src/cli/dossiers.ts 5 240 [--wave=2|3|4|5]`):

  | Wave | Rewrite |
  |---|---|
  | fl-001–190 | 190 |
  | fl-201–249 | 49 |
  | fl-301–549 | 249 |
  | fl-601–640 | 40 |
  | fl-701–807 | 107 |
  | fl-900–920 | 21 |
  | **All** | **656** |

  Seed 5 still qualifies as canon (scan 19.1). Its continental contact moves earlier, from AY 4623 to 4295, and it has 12 colonies instead of 20.
- *Stage 1 only.* The world is identical and all 656 flagships are still accepted. The stale ones are the flagships that quote figures which changed, or cite documents that moved:

  | Wave | Quote changed figures | Cite a vanished or different document | Cite a document whose text changed | Need revision |
  |---|---|---|---|---|
  | fl-001–190 | 1 | 0 | 0 | 1 |
  | fl-201–249 | 27 | 0 | 30 | 31 |
  | fl-301–549 | 7 | 0 | 0 | 7 |
  | fl-601–640 | 37 | 3 | 13 | 37 |
  | fl-701–807 | 2 | 0 | 0 | 2 |
  | fl-900–920 | 20 | 9 | 19 | 21 |
  | **All** | **94** | **12** | **62** | **99** |

  - Six catalogue numbers move. Muster rolls and modern genres select on battle figures, and survival is keyed by generation order.
    - Four no longer exist: PAL·GR·00137, PAL·MU·00669, PAL·TF·00017 and PAL·AL·00451. The checker fails on them until they are re-cited.
    - Two now name other documents: PAL·AN·00352 and PAL·NP·00021.
  - The other 557 flagships are untouched.
  - `flagship-drift.ts --list` names each stale flagship with its figures and citations.
  - The fingerprint covers events, not their data. So this drift is silent unless the tool is run.

**Recommendation: migrate in two steps, not one.**
1. **Now:** cherry-pick stage 1 (`87a1671`) and the archive guard (`b146c84`) onto main, then revise the 99 stale flagships in the same change.
   - Regenerate the wave 2/4/5 dossiers for the new figures, re-cite the six catalogue numbers, and update the quoted casualties.
   - This fixes everything readers can see: absurd battles, armies and rebels, dead signatories, early coins, conversions, posthumous foundings. It costs about 15% of a full rewrite and keeps every name, event and History chapter.
   - It does not fix the dynamics. Rebels still almost always lose (6%), and newborn states still draw pile-on wars. #17 also remains.
2. **Later, as a planned second edition:** merge stage 2 together with #18 and any other simulation changes. Rewrite all 656 flagships once, and re-run the seed scan.
   - Stage 2's added realism is real: rebellions that sometimes win, no defenceless newborn states, and every act inside its actor's lifetime.
   - But readers mostly cannot see it, and it costs the whole flagship corpus. It is worth paying once, for a batch of changes, not for these alone.

**Why.** The bugs that hurt credibility are in the numbers, not in who wins. Stage 1 separates the two, so the world can be fixed where readers look, at a known and bounded cost. The deeper model waits on the branch, measured, until a full rewrite is worth paying for.
