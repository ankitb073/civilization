# 0009: Seed 5 is the canonical world

**Context.** Any seed produces a world. The published atlas needs one, and agent-written flagship documents are tied to its ids. So the choice has to be made once and recorded.

**Decision.** Seed **5**, chosen from a scan of seeds 1–40 (`engine/src/debug/scan.ts`). The scan scored each world on:
- industrialization timing (steam in AY 4650–4860, computing by AY 5000);
- great empires and their collapses;
- a trade collapse;
- a magnitude-7 eruption;
- continental first contact in an "age of discovery" window (AY 3600–4750);
- colonies, revolutions and schisms.

Finalists were then judged by eye on their maps.

| Seed | Steam | Computing | Continental contact | Colonies | Revolutions | VEI 7 | Longest state | Score |
|---|---|---|---|---|---|---|---|---|
| **5** | 4741 | 4947 | 4623 | 20 | 44 | 5 | 933 yrs | 19.9 |
| 18 | 4800 | 4971 | 4496 | 20 | 41 | 8 | 1156 yrs | 19.9 |
| 25 | 4776 | 4917 | 4193 | 28 | 42 | 5 | 4194 yrs | 19.9 |

**Why seed 5.**
- Its continents are clearly separated by open ocean, so the two halves of the world meet late and dramatically.
- No tiny island state survives for 4,000 years. Seed 25 has one: implausible, and a poor "longest-lived state" exhibit.
- It has a clean coastline for the atlas.

The scan also drove calibration changes before the final choice:
- shorter pre-navigation sea range;
- a steeper industrial-era invention hazard;
- slow loss of cohesion in very old states;
- dissolution of small states in deep crisis.

Any other seed still builds (`npm run build:data -- 18`).
