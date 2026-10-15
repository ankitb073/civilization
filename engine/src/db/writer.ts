// Writes simulation state to SQLite. Called once per simulated century (append-only logs and
// new events; entity rows replaced) and once at the end (full refresh of mutable rows).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { State } from '../sim/state.ts';
import type { SimResult } from '../sim/run.ts';
import { SCHEMA, INDEXES } from './schema.ts';
import { TECHS } from '../sim/tech.ts';
import { GOODS } from '../sim/economy.ts';
import type { Archive } from '../archive/build.ts';

type Row = (number | string | null)[];

export class WorldDb {
  readonly db: DatabaseSync;
  private cursors = { events: 0, territory: 0, culture: 0, religion: 0, polityYears: 0, prices: 0, routes: 0, climate: 0 };

  constructor(path: string, fresh = true) {
    if (fresh && existsSync(path)) {
      rmSync(path);
      for (const ext of ['-wal', '-shm']) if (existsSync(path + ext)) rmSync(path + ext);
    }
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  private insert(table: string, rows: Row[], replace = false): void {
    if (rows.length === 0) return;
    const n = rows[0].length;
    const stmt = this.db.prepare(`INSERT ${replace ? 'OR REPLACE ' : ''}INTO ${table} VALUES (${new Array(n).fill('?').join(',')})`);
    for (const r of rows) stmt.run(...r);
  }

  tx(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  setMeta(key: string, value: unknown): void {
    this.db.prepare('INSERT OR REPLACE INTO meta VALUES (?, ?)').run(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  /** Static world + initial state, written once before the first century. */
  writeWorld(r: SimResult): void {
    const s = r.state;
    const w = s.world;
    this.tx(() => {
      this.setMeta('seed', String(s.seed));
      this.setMeta('world', { width: w.width, height: w.height, n: w.n, cellArea: w.cellArea, riverThreshold: w.riverThreshold });
      const cells: Row[] = [];
      for (let i = 0; i < w.n; i++) {
        cells.push([i, w.x[i], w.y[i], r6(w.elev[i]), w.land[i], w.biome[i], r2(w.temp[i]), Math.round(w.precip[i]), r4(w.flux[i]), r4(w.fertility[i]), w.resources[i], w.region[i], w.landmass[i]]);
      }
      this.insert('cells', cells);
      this.insert('regions', s.regionNames.map((nm, i) => [i, nm, w.regionLabelCell[i], w.regionLandmass[i]]));
      this.insert('rivers', w.rivers.map((rv, i) => [i, s.riverNames[i], JSON.stringify(rv.cells), r4(rv.flux)]));
      this.insert('initial_state', Array.from({ length: w.n }, (_, i) => [i, r.initial.culture[i], r.initial.religion[i]]));
      this.insert('techs', TECHS.map((t) => [t.id, t.key, t.name, t.target, t.era, JSON.stringify(t.prereqs)]));
      this.insert('goods', GOODS.map((g) => [g.id, g.key, g.name, g.unit, g.base]));
    });
  }

  /** Called at the end of every simulated century. */
  flushCentury(r: SimResult, year: number): void {
    const s = r.state;
    this.tx(() => {
      this.writeEntities(s);
      // events: re-write the recent tail (wars and anomalies can still be updated), then append new ones
      const from = Math.max(0, this.cursors.events - 1500);
      this.writeEvents(s, from, s.events.length);
      this.cursors.events = s.events.length;
      this.cursors.territory = this.appendLog('territory_log', s.territoryLog, this.cursors.territory);
      this.cursors.culture = this.appendLog('culture_log', s.cultureLog, this.cursors.culture);
      this.cursors.religion = this.appendLog('religion_log', s.religionLog, this.cursors.religion);
      this.insert('polity_years', s.polityYears.slice(this.cursors.polityYears) as Row[]);
      this.cursors.polityYears = s.polityYears.length;
      const pb = r.econ.priceBuf;
      const prices: Row[] = [];
      for (let i = this.cursors.prices; i < pb.length; i += 4) prices.push([pb[i], pb[i + 1], pb[i + 2], pb[i + 3]]);
      this.insert('prices', prices);
      this.cursors.prices = pb.length;
      const routes: Row[] = [];
      for (const rt of s.routes.slice(this.cursors.routes)) for (const [a, b, v] of rt.edges) routes.push([rt.year, a, b, v]);
      this.insert('routes', routes);
      this.cursors.routes = s.routes.length;
      this.insert('climate', s.climate.slice(this.cursors.climate).map((c) => [c.year, c.temp, c.precip]), true);
      this.cursors.climate = s.climate.length;
      let pop = 0;
      for (let i = 0; i < s.world.n; i++) pop += s.pop[i];
      this.insert('centuries', [[year, s.events.length, s.polities.filter((p) => p.died === null).length, s.wars.filter((x) => x.ended === null).length, Math.round(pop)]], true);
    });
  }

  /** Final pass: every mutable row refreshed, language data written, indexes built. */
  finalize(r: SimResult): void {
    const s = r.state;
    this.tx(() => {
      this.writeEntities(s);
      this.db.exec('DELETE FROM events; DELETE FROM event_parts; DELETE FROM event_causes;');
      this.writeEvents(s, 0, s.events.length, false);
      const settlementPop: Row[] = [];
      for (const t of s.settlements) for (const [y, p] of t.popHistory) settlementPop.push([t.id, y, p]);
      this.db.exec('DELETE FROM settlement_pop');
      this.insert('settlement_pop', settlementPop);
      this.db.exec('DELETE FROM final_state');
      this.insert('final_state', Array.from({ length: s.world.n }, (_, i) => [i, s.owner[i], s.culture[i], s.religion[i]]));
      // languages
      this.db.exec('DELETE FROM languages; DELETE FROM sound_changes;');
      const langs = s.lang.languages();
      this.insert('languages', langs.map((l) => [l.id, l.parent, l.family, l.born, l.died, l.endonym, JSON.stringify(l.typology), s.lang.familyStyle(l.id)]));
      const sc: Row[] = [];
      for (const l of langs) for (const c of s.lang.soundChanges(l.id)) if (c.lang === l.id) sc.push([l.id, c.year, c.rule, c.label]);
      this.insert('sound_changes', sc);
      this.db.exec('DELETE FROM names');
      const names: Row[] = [];
      for (let id = 0; id < s.lang.nameCount(); id++) {
        const o = s.lang.nameOrigin(id);
        names.push([id, s.lang.nameKind(id), o.lang, o.year, s.lang.nameMeaning(id), s.lang.realize(id, o.lang, o.year).conventional]);
      }
      this.insert('names', names);
      this.setMeta('lang_engine', JSON.stringify(s.lang.toJSON()));
    });
    this.db.exec(INDEXES);
  }

  /** Archive layer: extant documents, every page and every link. */
  writeArchive(a: Archive): void {
    this.tx(() => {
      this.db.exec('DELETE FROM artifacts; DELETE FROM links; DELETE FROM pages;');
      this.insert('artifacts', a.artifacts.map((x) => [
        x.id, x.sub, x.year, x.catalog, x.title, x.author, x.cell, x.settlement, x.lang, x.script, x.medium, x.polity, JSON.stringify(x.about),
        x.condition, x.provenance, x.translator, x.foundYear, x.flagship ? 1 : 0, x.body, JSON.stringify(x.data ?? {}),
      ]));
      const links: Row[] = [];
      const pages: Row[] = [];
      for (const pg of a.pages.values()) {
        for (const l of pg.links) links.push([pg.id, l]);
        pages.push([pg.id, pg.kind, pg.sub, pg.title, pg.t0, pg.t1, pg.backlinks.length]);
      }
      this.insert('links', links);
      this.insert('pages', pages);
      this.setMeta('archive', { editorialLang: a.ctx.editorialLang, editorialPolity: a.ctx.editorialPolity, pages: a.pages.size, artifacts: a.artifacts.length, links: a.links });
    });
  }

  private appendLog(table: string, log: number[], from: number): number {
    const rows: Row[] = [];
    for (let i = from; i < log.length; i += 4) rows.push([i / 4, log[i], log[i + 1], log[i + 2], log[i + 3]]);
    this.insert(table, rows);
    return log.length;
  }

  private writeEvents(s: State, from: number, to: number, replace = true): void {
    if (replace && from < to) {
      this.db.prepare('DELETE FROM event_parts WHERE event >= ?').run(from);
      this.db.prepare('DELETE FROM event_causes WHERE event >= ?').run(from);
    }
    const ev: Row[] = [], parts: Row[] = [], causes: Row[] = [];
    for (let i = from; i < to; i++) {
      const e = s.events[i];
      ev.push([e.id, e.sub, e.year, e.end, e.cell, r4(e.sig), JSON.stringify(e.data)]);
      for (const [ref, role] of e.parts) parts.push([e.id, ref, role]);
      for (const c of e.causes) causes.push([e.id, c]);
    }
    this.insert('events', ev, true);
    this.insert('event_parts', parts);
    this.insert('event_causes', causes);
  }

  private writeEntities(s: State): void {
    this.insert('cultures', s.cultures.map((c) => [c.id, c.nameId, c.lang, c.parent, c.born, c.died, c.homeCell, c.pantheon, c.script, c.pastoral ? 1 : 0, c.bornEvent]), true);
    this.insert('scripts', s.scripts.map((c) => [c.id, c.nameId, c.kind, c.parent, c.originLang, c.culture, c.born, c.event]), true);
    this.insert('polities', s.polities.map((p) => [
      p.id, p.nameId, p.nameBasis, p.culture, p.born, p.died, p.foundEvent, p.endEvent, p.kind, p.color, p.predecessor, p.successionLaw,
      JSON.stringify(p.capitals), JSON.stringify(p.govs), JSON.stringify([...p.techs]),
    ]), true);
    this.insert('persons', s.persons.map((p) => [
      p.id, p.nameId, p.sex, p.born, p.died, p.deathCause, p.deathEvent, p.culture, p.polity, p.father, p.mother,
      JSON.stringify(p.spouses), p.dynasty, r4(p.skill), p.epithet,
    ]), true);
    this.db.exec('DELETE FROM roles');
    const roles: Row[] = [];
    // offices end with their holder: the decadal step can close a role a few years after its holder died
    for (const p of s.persons) for (const r of p.roles) roles.push([p.id, r.role, r.polity, r.start, r.end === null ? null : Math.min(r.end, Math.max(r.start, p.died)), r.event, r.ref ?? null]);
    this.insert('roles', roles);
    this.insert('dynasties', s.dynasties.map((d) => [d.id, d.nameId, d.founder, d.polity, d.start, d.end]), true);
    this.insert('settlements', s.settlements.map((t) => [t.id, t.nameId, t.cell, t.founded, t.abandoned, t.foundEvent, t.endEvent, t.culture, t.peakPop, t.port ? 1 : 0, JSON.stringify(t.names), JSON.stringify(t.sacks)]), true);
    this.insert('movements', s.movements.map((m) => [m.id, m.nameId, m.kind, m.parent, m.culture, m.founder, m.born, m.died, JSON.stringify(m.tenets), m.originCell, m.foundEvent, Math.round(m.peak)]), true);
    this.insert('deities', s.deities.map((d) => [d.id, d.nameId, d.culture, d.movement, d.domain, d.sex, d.born]), true);
    this.insert('currencies', s.currencies.map((c) => [c.id, c.nameId, c.polity, c.kind, c.metal, c.born, c.died, c.event, JSON.stringify(c.history)]), true);
    this.insert('houses', s.houses.map((h) => [h.id, h.nameId, h.founder, h.settlement, h.born, h.died, h.foundEvent, h.endEvent, h.kind, JSON.stringify(h.goods), JSON.stringify(h.heads)]), true);
    this.insert('anomalies', s.anomalies.map((a) => [a.id, a.kind, a.start, a.end, r4(a.severity), a.volcanoCell, a.nameId, a.event, JSON.stringify(a.cells)]), true);
  }

  close(): void {
    this.db.close();
  }
}

function r2(x: number): number { return Math.round(x * 100) / 100; }
function r4(x: number): number { return Math.round(x * 10000) / 10000; }
function r6(x: number): number { return Math.round(x * 1e6) / 1e6; }
