// The world database: the record of truth the archive is generated from and the checker verifies.

export const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = OFF;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS cells (
  id INTEGER PRIMARY KEY, x REAL, y REAL, elev REAL, land INTEGER, biome INTEGER, temp REAL, precip REAL,
  flux REAL, fertility REAL, resources INTEGER, region INTEGER, landmass INTEGER
);
CREATE TABLE IF NOT EXISTS regions (id INTEGER PRIMARY KEY, name_id INTEGER, label_cell INTEGER, landmass INTEGER);
CREATE TABLE IF NOT EXISTS rivers (id INTEGER PRIMARY KEY, name_id INTEGER, cells TEXT, flux REAL);

CREATE TABLE IF NOT EXISTS languages (id INTEGER PRIMARY KEY, parent INTEGER, family INTEGER, born INTEGER, died INTEGER, endonym INTEGER, typology TEXT, style TEXT);
CREATE TABLE IF NOT EXISTS sound_changes (lang INTEGER, year INTEGER, rule TEXT, label TEXT);
CREATE TABLE IF NOT EXISTS names (id INTEGER PRIMARY KEY, kind TEXT, lang INTEGER, year INTEGER, meaning TEXT, form TEXT);

CREATE TABLE IF NOT EXISTS cultures (id INTEGER PRIMARY KEY, name_id INTEGER, lang INTEGER, parent INTEGER, born INTEGER, died INTEGER, home_cell INTEGER, pantheon INTEGER, script INTEGER, pastoral INTEGER, born_event INTEGER);
CREATE TABLE IF NOT EXISTS scripts (id INTEGER PRIMARY KEY, name_id INTEGER, kind TEXT, parent INTEGER, origin_lang INTEGER, culture INTEGER, born INTEGER, event INTEGER);
CREATE TABLE IF NOT EXISTS polities (
  id INTEGER PRIMARY KEY, name_id INTEGER, name_basis TEXT, culture INTEGER, born INTEGER, died INTEGER,
  found_event INTEGER, end_event INTEGER, kind TEXT, color TEXT, predecessor INTEGER, succession_law TEXT,
  capitals TEXT, govs TEXT, techs TEXT
);
CREATE TABLE IF NOT EXISTS polity_years (
  polity INTEGER, year INTEGER, cells INTEGER, pop INTEGER, urban_pop INTEGER, treasury INTEGER, army INTEGER,
  stability REAL, gov TEXT, ruler INTEGER, capital INTEGER, religion INTEGER, currency INTEGER, era INTEGER
);
CREATE TABLE IF NOT EXISTS persons (
  id INTEGER PRIMARY KEY, name_id INTEGER, sex TEXT, born INTEGER, died INTEGER, death_cause TEXT, death_event INTEGER,
  culture INTEGER, polity INTEGER, father INTEGER, mother INTEGER, spouses TEXT, dynasty INTEGER, skill REAL, epithet TEXT
);
CREATE TABLE IF NOT EXISTS roles (person INTEGER, role TEXT, polity INTEGER, start INTEGER, end_year INTEGER, event INTEGER, ref TEXT);
CREATE TABLE IF NOT EXISTS dynasties (id INTEGER PRIMARY KEY, name_id INTEGER, founder INTEGER, polity INTEGER, start INTEGER, end_year INTEGER);
CREATE TABLE IF NOT EXISTS settlements (
  id INTEGER PRIMARY KEY, name_id INTEGER, cell INTEGER, founded INTEGER, abandoned INTEGER, found_event INTEGER,
  end_event INTEGER, culture INTEGER, peak_pop INTEGER, port INTEGER, names TEXT, sacks TEXT
);
CREATE TABLE IF NOT EXISTS settlement_pop (settlement INTEGER, year INTEGER, pop INTEGER);
CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY, name_id INTEGER, kind TEXT, parent INTEGER, culture INTEGER, founder INTEGER, born INTEGER,
  died INTEGER, tenets TEXT, origin_cell INTEGER, found_event INTEGER, peak REAL
);
CREATE TABLE IF NOT EXISTS deities (id INTEGER PRIMARY KEY, name_id INTEGER, culture INTEGER, movement INTEGER, domain TEXT, sex TEXT, born INTEGER);
CREATE TABLE IF NOT EXISTS currencies (id INTEGER PRIMARY KEY, name_id INTEGER, polity INTEGER, kind TEXT, metal TEXT, born INTEGER, died INTEGER, event INTEGER, history TEXT);
CREATE TABLE IF NOT EXISTS houses (
  id INTEGER PRIMARY KEY, name_id INTEGER, founder INTEGER, settlement INTEGER, born INTEGER, died INTEGER,
  found_event INTEGER, end_event INTEGER, kind TEXT, goods TEXT, heads TEXT
);
CREATE TABLE IF NOT EXISTS anomalies (id INTEGER PRIMARY KEY, kind TEXT, start INTEGER, end_year INTEGER, severity REAL, volcano_cell INTEGER, name_id INTEGER, event INTEGER, cells TEXT);
CREATE TABLE IF NOT EXISTS techs (id INTEGER PRIMARY KEY, key TEXT, name TEXT, target INTEGER, era INTEGER, prereqs TEXT);
CREATE TABLE IF NOT EXISTS goods (id INTEGER PRIMARY KEY, key TEXT, name TEXT, unit TEXT, base REAL);

CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, sub TEXT, year INTEGER, end_year INTEGER, cell INTEGER, sig REAL, data TEXT);
CREATE TABLE IF NOT EXISTS event_parts (event INTEGER, ref TEXT, role TEXT);
CREATE TABLE IF NOT EXISTS event_causes (event INTEGER, cause INTEGER);

CREATE TABLE IF NOT EXISTS territory_log (seq INTEGER PRIMARY KEY, year INTEGER, cell INTEGER, owner INTEGER, event INTEGER);
CREATE TABLE IF NOT EXISTS culture_log (seq INTEGER PRIMARY KEY, year INTEGER, cell INTEGER, culture INTEGER, event INTEGER);
CREATE TABLE IF NOT EXISTS religion_log (seq INTEGER PRIMARY KEY, year INTEGER, cell INTEGER, movement INTEGER, event INTEGER);
CREATE TABLE IF NOT EXISTS initial_state (cell INTEGER PRIMARY KEY, culture INTEGER, religion INTEGER);

CREATE TABLE IF NOT EXISTS climate (year INTEGER PRIMARY KEY, temp REAL, precip REAL);
CREATE TABLE IF NOT EXISTS prices (year INTEGER, settlement INTEGER, good INTEGER, price REAL);
CREATE TABLE IF NOT EXISTS routes (year INTEGER, a INTEGER, b INTEGER, volume REAL);

CREATE TABLE IF NOT EXISTS centuries (year INTEGER PRIMARY KEY, written_at_event INTEGER, polities INTEGER, wars INTEGER, population INTEGER);

-- archive layer
CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY, sub TEXT, year INTEGER, catalog TEXT, title TEXT, author INTEGER, cell INTEGER, settlement INTEGER,
  lang INTEGER, script INTEGER, medium TEXT, polity INTEGER, about TEXT, condition TEXT, provenance TEXT, translator INTEGER,
  found_year INTEGER, flagship INTEGER, body TEXT, data TEXT
);
CREATE TABLE IF NOT EXISTS links (source TEXT, target TEXT);
CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, kind TEXT, sub TEXT, title TEXT, t0 INTEGER, t1 INTEGER, backlinks INTEGER);
CREATE TABLE IF NOT EXISTS final_state (cell INTEGER PRIMARY KEY, owner INTEGER, culture INTEGER, religion INTEGER);
`;

export const INDEXES = `
CREATE INDEX IF NOT EXISTS ix_parts_event ON event_parts(event);
CREATE INDEX IF NOT EXISTS ix_parts_ref ON event_parts(ref);
CREATE INDEX IF NOT EXISTS ix_causes_event ON event_causes(event);
CREATE INDEX IF NOT EXISTS ix_roles_person ON roles(person);
CREATE INDEX IF NOT EXISTS ix_terr_year ON territory_log(year);
CREATE INDEX IF NOT EXISTS ix_terr_cell ON territory_log(cell, year);
CREATE INDEX IF NOT EXISTS ix_py ON polity_years(polity, year);
CREATE INDEX IF NOT EXISTS ix_prices ON prices(settlement, good, year);
CREATE INDEX IF NOT EXISTS ix_links_target ON links(target);
CREATE INDEX IF NOT EXISTS ix_events_year ON events(year);
`;
