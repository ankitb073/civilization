# LLD: Simulation (`engine/src/sim/`)

## Loop

```
for century in 0..49:
  for decade in 0..9:            // year = century*100 + decade*10
    climate.step       → decadal anomaly, eruptions, droughts (climate entities)
    population.step    → capacity × yield, growth, famine, plague, migration
    settlements.step   → found, grow, abandon
    tech.step          → inventions (hazard model around target dates), diffusion, losses on collapse
    economy.step       → production, trade routes, prices, currencies, houses, panics
    politics.step      → aggregates, stability, succession, revolts, civil war, collapse, gov change
    diplomacy.step     → opinion drift, alliances, marriages, pacts
    war.step           → declarations, yearly campaigns and battles, peace treaties
    culture.step       → assimilation, contact registration
    religion.step      → founding, spread, conversion, schism, councils, persecution
  century end: language splits, sound changes (lang.advanceTo), keyframes, DB flush + checkpoint
```

## Events and causality

`state.event(sub, year, {cell, parts, causes, data})` creates an event. It throws if any cause's year is later than `year`. Every territory, culture or religion change is a log row `(cell, year, value, eventId)`. Every ruler change, debasement, conversion and so on references an event. Causes are chosen as follows:

| Event | Causes |
|---|---|
| war | prior wars between the pair, a succession dispute, an embargo, famine in the target (opportunism), religious tension (a conversion or persecution), a border expansion |
| famine | the climate anomaly entity active in the region; war devastation |
| collapse / civil war | the top stressors of the last 50 years (famines, lost wars, debasements, plague, trade collapse, succession crisis) |
| treaty | its war, plus the decisive battles |
| debasement | the war(s) that drained the treasury |
| panic / bankruptcy | the defaults, wars and route closures that hit the house |
| movement founding | a recent crisis in that polity, where there was one |

## Calibration targets (analogous to Earth history from 3000 BCE)

| Milestone | Target AY (± spread) |
|---|---|
| Writing (first) | 0–200 |
| Bronze-working diffuses | 0–500 |
| Chariot | 1300 |
| Iron | 1750 |
| Alphabet | 1900 |
| Coinage | 2350 |
| Axial-age philosophy | 2400–2700 |
| Paper | 3200 |
| Compass/ocean navigation | 4350 |
| Printing | 4450 |
| Gunpowder weapons | 4300 |
| Banking/joint-stock | 4300 / 4600 |
| Steam | 4760 |
| Rail/telegraph | 4830 |
| Electricity | 4880 |
| Computing | 4950 |

Techs use a hazard model: `p(invent per decade) = clamp(0.002 · exp((year − target)/140) · dev, 0, 0.5)`, where `dev` comes from urbanization, literacy and trade connectivity. A tech diffuses along trade and borders with a lag. A polity can lose techs when it collapses and none of its successors' neighbors know them.

## Key quantities

- **Cell capacity:** `K = area · (biome.capacity + fertility · 14 · riverBoost · workability(tech, biome)) · agriMult(tech) · yield(climate)`. Forests and heavy soils become workable with iron and the heavy plough.
- **Growth:** logistic, `r` from 0.0015/yr (Bronze Age) to 0.01/yr (industrial). In a famine, population above `K_eff` drops to `K_eff + 0.3·excess`, and a migration may trigger.
- **Urban share:** 5% → 12% → 18% → 30% → 55% → 75% by era. A settlement's population is urban share × catchment population × centrality.
- **Treasury:** in silver kg.
  - Revenue: `pop · taxPerCapita(era) · efficiency(stability, admin)`.
  - Spending: army upkeep (×3 at war), administration, tribute.
  - A deficit creates debt (when banking is known) or a debasement (when coinage is known).
- **Army:** two quantities (decision 0015).
  - *Headcount* (`soldiers`, men under arms): `max(pop · mobilization(era), min(pop · 5%, 500)) · treasuryFactor`. Every state can muster a few hundred men; a rebellion raises 2% of its province and takes that province's share of the crown's men with it. Losses are made good at a quarter of the gap a year. Battle sizes, casualties and the `polity_years.army` series count men.
  - *Strength* (`army`): `pop · mobilization(era) · techMil · treasuryFactor`. It sets the odds and the appetite for war.
- **Battles:** win probability is `σ(1.4·ln(Sa/Sd) + general skill + terrain)`. Each side engages 35–85% of its men (allies send 40%). The beaten side loses 6–36% of the men it engaged, more in a rout. The victor loses that divided by a ratio of about 1.5 in a close fight to 5 in a rout (log-normal scatter, so a costly victory stays possible), capped at a quarter of its own men.
- **Stability:** recovers toward 0.7 over time and moves with these terms:

  | Effect | Driver |
  |---|---|
  | Penalty | overextension |
  | Penalty | culture and religion mismatch |
  | Penalty | lost wars |
  | Penalty | famine |
  | Penalty | debasement (inflation) |
  | Penalty | plague |
  | Penalty | regency or illegitimate ruler |
  | Bonus | victories |
  | Bonus | prosperity |

  Below 0.25 there are revolts. Below 0.1 a civil war or collapse follows.

## State persistence

Each century the simulation writes normalized rows (entities, events, logs, decadal polity stats, prices) in one transaction, plus a full JSON checkpoint (state and the language engine). `sim --resume` continues from the latest checkpoint and gives byte-identical output.
