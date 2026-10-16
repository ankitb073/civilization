# Data dictionary: `world.sqlite`

The world database is the record of truth. The simulation writes it century by century, the archive adds the documents and pages, and the checker audits it. Download it from the atlas's About page, or build it with `npm run build:data`.

Conventions:
- Years are integers in **Archive Years (AY)**, 0–5000; negative values mean before AY 0.
- `*_event` columns point to `events.id`.
- `name_id` columns point to `names.id`. Names are realized per language and date by the language engine; `names.form` is the form at coinage.
- Entity ids in links and page ids use prefixes: `pol:`, `per:`, `set:`, `reg:`, `riv:`, `cul:`, `lan:`, `scr:`, `mov:`, `dei:`, `cur:`, `hou:`, `tec:`, `cli:`, `evt:`, `art:`.

## World

| Table | Rows | Notes |
|---|---|---|
| `meta` | key/value | seed, world size, archive summary, the serialized language engine (`lang_engine`) |
| `cells` | ~7.9k | Voronoi cells: position, elevation (−1..1, sea < 0), biome, temperature (°C), precipitation (mm/yr), river flux, fertility, resource bit flags, region, landmass |
| `regions`, `rivers` | | named geography; `rivers.cells` is a JSON path from source to mouth |
| `initial_state` | per cell | culture and religion before any log entry (ownership starts empty) |
| `final_state` | per cell | owner, culture and religion at AY 5000; replaying the logs over `initial_state` must reproduce it |

## Change logs (replayable)

| Table | Columns |
|---|---|
| `territory_log` | `seq, year, cell, owner, event`: every change of a cell's state; `owner = -1` means no state |
| `culture_log` | `seq, year, cell, culture, event`; `event = -1` is gradual assimilation under the ruling state |
| `religion_log` | `seq, year, cell, movement, event`; `event = -1` is gradual conversion |

Logs are non-decreasing in `year`. To get the map at year *Y*, apply all rows with `year ≤ Y` in `seq` order.

## Entities

| Table | Notes |
|---|---|
| `polities` | states: culture, life span, founding and end events, `capitals` / `govs` / `techs` (JSON histories), predecessor, kind (`state`, `rebel`, …), succession law |
| `polity_years` | decadal statistics per polity, recorded at the **end** of each decade (row year = decade start, so the row labelled 1650 is the state at the end of 1659, or at the moment the polity ended if it ended within the decade): cells, population, urban population, treasury (kg silver), army (men under arms; before simulation v2 stage 1 this was strength), stability, government, ruler, capital, religion, currency, era. For an exact date use `roles` (rulers) and `territory_log` (districts). |
| `persons` | birth, death, cause and event of death, culture, parents, spouses (JSON), dynasty |
| `roles` | `person, role, polity, start, end_year, event, ref`: rulers, generals, merchants, founders, prophets, scribes, historians, translators… |
| `dynasties` | founder, polity, span |
| `settlements` | city, founding and abandonment, culture of founders, peak population, renames and sacks (JSON) |
| `settlement_pop` | population per century |
| `cultures` | peoples: language, parent people, pantheon, script, pastoral flag |
| `languages`, `sound_changes` | family tree (`parent`, `family`) and every dated sound law (`rule` in notation, `label`) |
| `scripts` | writing systems: kind (logosyllabic, syllabary, abjad, alphabet), parent script, language of the logograms |
| `movements`, `deities` | pantheons, religions, sects, reform movements, philosophies and ideologies, with tenet vectors (JSON) and gods by domain |
| `currencies` | weight standards, coins, paper and fiat money; `history` is `[year, grams of silver per unit]` and shows every debasement |
| `houses` | merchant houses, companies and banks: seat, goods, heads |
| `anomalies` | climate anomalies: eruptions (VEI), droughts (cells), cold spells, the industrial warming |
| `climate` | global temperature anomaly and precipitation index per decade |
| `prices` | grams of silver per unit, per market, good and decade (`goods` lists units and base prices) |
| `routes` | trade routes per century with relative volume |
| `techs` | the technology tree with target dates and prerequisites |

## Events and causality

| Table | Notes |
|---|---|
| `events` | `id, sub, year, end_year, cell, sig, data`; `sub` is the kind (war, battle, treaty, collapse, plague, eruption, conversion, …); `data` is JSON (treaty terms, battle sizes and losses, debasement before and after, …). An `invention` with `independent: false` is the world's first; `independent: true` is a later reinvention by a people with no contact to the earlier inventors (spread by contact is not an event: it shows only in the state's technology dates) |
| `event_parts` | `event, ref, role`: who took part, and how |
| `event_causes` | `event, cause`: every cause is recorded before its effect and dated no later |

## Archive

| Table | Notes |
|---|---|
| `artifacts` | surviving documents: type (`sub`), year, catalogue number, title, author, place, language, script, medium, condition, provenance, translator, flagship flag, Markdown `body` (links are `[[id\|text]]`; the editorial apparatus follows the first `---` line), and `data` (e.g. ledger entries with market, good, unit price and coin weight) |
| `pages` | every page with its kind, sub-type, title, span and backlink count |
| `links` | `source, target`: every link between pages |

## Example queries

```sql
-- The ten deadliest wars
SELECT id, year, end_year, json_extract(data,'$.lossesA') + json_extract(data,'$.lossesD') AS dead
FROM events WHERE sub = 'war' ORDER BY dead DESC LIMIT 10;

-- Who held cell 1234 in AY 2500?
SELECT owner FROM territory_log WHERE cell = 1234 AND year <= 2500 ORDER BY seq DESC LIMIT 1;

-- A currency's debasement history
SELECT history FROM currencies WHERE id = 7;

-- Documents that mention a given state
SELECT a.catalog, a.title FROM links l JOIN artifacts a ON 'art:' || a.id = l.source WHERE l.target = 'pol:8';
```
