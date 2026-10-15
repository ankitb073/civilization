// Cultures: assimilation under rule, elite acculturation, language contact, ethnogenesis (splits),
// literacy and scripts.
import type { State, Culture, Script } from './state.ts';
import { event, ref, setCulture, alivePolity, PALETTE } from './state.ts';
import type { Geo } from './geo.ts';
import { components, majority } from './geo.ts';
import type { PolityAgg } from './polities.ts';
import { has } from './tech.ts';
import type { ScriptKind } from '../lang/index.ts';

export function newCulture(s: State, o: { lang: number; parent: number | null; born: number; homeCell: number; pastoral: boolean; pantheon: number; script: number; key: string; bornEvent: number | null }): Culture {
  const id = s.cultures.length;
  const nameId = s.lang.coinName(o.lang, Math.max(o.born, s.lang.info(o.lang).born), 'people', `cul:${o.key}`);
  const c: Culture = {
    id, nameId, lang: o.lang, parent: o.parent, born: o.born, died: null, homeCell: o.homeCell,
    color: PALETTE[(id * 5 + 3) % PALETTE.length], pantheon: o.pantheon, script: o.script, pastoral: o.pastoral,
    divergence: 0, bornEvent: o.bornEvent,
  };
  s.cultures.push(c);
  return c;
}

export function cultureStep(s: State, geo: Geo, agg: PolityAgg, y0: number, centuryEnd: boolean): void {
  const w = s.world;
  const rng = s.rng.fork('culture', y0);
  const yLog = Math.max(y0 + 9, s.lastLogYear.culture);
  // assimilation toward the ruling culture
  for (const c of geo.landCells) {
    const o = s.owner[c];
    if (o < 0) continue;
    const p = s.polities[o];
    const cur = s.culture[c];
    if (cur === p.culture || cur < 0) continue;
    let pr = 0.01;
    if (s.settlementAt[c] >= 0) pr *= 2.2;
    if (s.religion[c] === p.religion) pr *= 1.5;
    if (s.lang.info(s.cultures[cur].lang).family !== s.lang.info(s.cultures[p.culture].lang).family) pr *= 0.5;
    if (has(p, 'printing')) pr *= 1.4;
    if (has(p, 'railway')) pr *= 1.5;
    if (rng.chance(pr)) setCulture(s, c, p.culture, yLog, -1);
  }
  // elite acculturation: rulers adopt the majority culture after long minority rule
  for (const p of s.polities) {
    if (!alivePolity(p, y0) || y0 - p.born < 120) continue;
    const cells = agg.cells.get(p.id) ?? [];
    if (cells.length < 8) continue;
    const maj = majority(s.culture, cells, s.pop);
    if (maj < 0 || maj === p.culture) continue;
    let share = 0, tot = 0;
    for (const c of cells) { tot += s.pop[c]; if (s.culture[c] === p.culture) share += s.pop[c]; }
    if (tot > 0 && share / tot < 0.15 && rng.chance(0.15)) {
      const year = y0 + rng.int(0, 9);
      event(s, 'acculturation', year, { cell: s.settlements[p.capital].cell, parts: [[ref('pol', p.id), 'polity'], [ref('cul', p.culture), 'from'], [ref('cul', maj), 'to']], sig: 0.2 });
      p.culture = maj;
    }
  }
  // language contact along cultural borders (once per century)
  if (centuryEnd) {
    const seen = new Set<number>();
    for (const c of geo.landCells) {
      const a = s.culture[c];
      if (a < 0) continue;
      for (const k of w.neighbors[c]) {
        const b = s.culture[k];
        if (b < 0 || b === a) continue;
        const la = s.cultures[a].lang, lb = s.cultures[b].lang;
        if (la === lb) continue;
        const key = la < lb ? la * 65536 + lb : lb * 65536 + la;
        if (seen.has(key)) continue;
        seen.add(key);
        s.lang.recordContact(la, lb, y0);
      }
    }
    for (const [a, b] of s.activeRoutes) {
      const ca = s.settlements[a].culture, cb = s.settlements[b].culture;
      const la = s.cultures[ca].lang, lb = s.cultures[cb].lang;
      if (la !== lb) s.lang.recordContact(la, lb, y0);
    }
    splitCultures(s, geo, agg, y0 + 9, rng);
    // extinctions
    const count = new Map<number, number>();
    for (const c of geo.landCells) if (s.culture[c] >= 0) count.set(s.culture[c], (count.get(s.culture[c]) ?? 0) + 1);
    for (const cu of s.cultures) {
      if (cu.died !== null || (count.get(cu.id) ?? 0) > 0) continue;
      if (s.polities.some((p) => p.died === null && p.culture === cu.id)) continue;
      cu.died = y0 + 9;
      if (!s.cultures.some((o) => o.died === null && o.lang === cu.lang)) s.lang.retire(cu.lang, y0 + 9);
    }
  }
  literacy(s, y0, rng);
}

function splitCultures(s: State, geo: Geo, agg: PolityAgg, year: number, rng: import('../core/rng.ts').Rng): void {
  const byCulture = new Map<number, number[]>();
  for (const c of geo.landCells) {
    const cu = s.culture[c];
    if (cu < 0) continue;
    let a = byCulture.get(cu);
    if (!a) byCulture.set(cu, (a = []));
    a.push(c);
  }
  for (const [cid, cells] of [...byCulture.entries()].sort((a, b) => a[0] - b[0])) {
    const cu = s.cultures[cid];
    if (cells.length < 30) { cu.divergence = Math.max(0, cu.divergence - 0.5); continue; }
    // fragmentation: disconnected pieces or several polities holding large shares
    const comps = components(s, cells);
    const byOwner = new Map<number, number[]>();
    for (const c of cells) {
      const o = s.owner[c];
      let a = byOwner.get(o);
      if (!a) byOwner.set(o, (a = []));
      a.push(c);
    }
    const bigOwners = [...byOwner.entries()].filter(([, cs]) => cs.length >= cells.length * 0.22).sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
    let group: number[] | null = null;
    if (comps.length > 1 && comps[1].length >= 15) group = comps[1];
    else if (bigOwners.length >= 2) group = bigOwners[1][1];
    else {
      // sheer extent
      let mx = 0, my = 0;
      for (const c of cells) { mx += s.world.x[c]; my += s.world.y[c]; }
      mx /= cells.length; my /= cells.length;
      let v = 0;
      for (const c of cells) v += (s.world.x[c] - mx) ** 2 + (s.world.y[c] - my) ** 2;
      const sd = Math.sqrt(v / cells.length);
      if (sd > 230) {
        const far = cells.slice().sort((a, b) => Math.hypot(s.world.x[b] - mx, s.world.y[b] - my) - Math.hypot(s.world.x[a] - mx, s.world.y[a] - my) || a - b);
        group = components(s, far.slice(0, Math.floor(cells.length * 0.4)))[0];
      }
    }
    if (!group || group.length < 12) { cu.divergence = Math.max(0, cu.divergence - 0.5); continue; }
    cu.divergence += 1;
    if (cu.divergence < 2.5 || !rng.chance(0.6)) continue;
    cu.divergence = 0;
    const lang = s.lang.split(cu.lang, year, `split:${cid}:${year}`);
    const home = group[Math.floor(group.length / 2)];
    const ev = event(s, 'ethnogenesis', year, { cell: home, parts: [[ref('cul', cid), 'parent']], data: { cells: group.length }, sig: 0.3 });
    const child = newCulture(s, { lang, parent: cid, born: year, homeCell: home, pastoral: cu.pastoral, pantheon: cu.pantheon, script: cu.script, key: `${cid}:${year}`, bornEvent: ev.id });
    ev.parts.push([ref('cul', child.id), 'culture'], [ref('lan', lang), 'language']);
    for (const c of group) setCulture(s, c, child.id, Math.max(year, s.lastLogYear.culture), ev.id);
    // polities of that culture whose seat is in the group switch identity
    for (const p of s.polities) {
      if (p.died !== null || p.culture !== cid) continue;
      if (group.includes(s.settlements[p.capital].cell)) p.culture = child.id;
    }
    // settlements in the group are now spoken of in the new language
    for (const t of s.settlements) if (t.abandoned === null && group.includes(t.cell)) s.lang.localize(t.nameId, lang, year);
  }
}

function literacy(s: State, y0: number, rng: import('../core/rng.ts').Rng): void {
  for (const p of s.polities) {
    if (!alivePolity(p, y0) || !has(p, 'writing')) continue;
    const cu = s.cultures[p.culture];
    const wantAlpha = has(p, 'alphabet');
    const cur = cu.script >= 0 ? s.scripts[cu.script] : null;
    if (cur && (!wantAlpha || cur.kind === 'alphabet' || cur.kind === 'abjad')) continue;
    if (cur && wantAlpha && !rng.chance(0.25)) continue;
    // find a script among neighbours/trade partners
    const year = y0 + rng.int(0, 9);
    let source: Script | null = null;
    let bestD = Infinity;
    const cap = s.settlements[p.capital].cell;
    for (const q of s.polities) {
      if (!alivePolity(q, y0) || q.id === p.id) continue;
      const qc = s.cultures[q.culture];
      if (qc.script < 0) continue;
      const sc = s.scripts[qc.script];
      if (sc.born > year) continue;
      if (wantAlpha && sc.kind !== 'alphabet' && sc.kind !== 'abjad') continue;
      const d = Math.hypot(s.world.x[cap] - s.world.x[s.settlements[q.capital].cell], s.world.y[cap] - s.world.y[s.settlements[q.capital].cell]);
      if (d < bestD && d < 700) { bestD = d; source = sc; }
    }
    let kind: ScriptKind;
    let sub: string;
    if (source) {
      sub = 'script-adoption';
      kind = source.kind === 'logographic' ? 'logosyllabic' : source.kind === 'logosyllabic' && rng.chance(0.4) ? 'syllabary' : source.kind === 'abjad' && wantAlpha && rng.chance(0.4) ? 'alphabet' : source.kind;
    } else {
      sub = 'script-invention';
      kind = wantAlpha ? (cur ? 'abjad' : 'alphabet') : cu.script < 0 ? 'logosyllabic' : 'syllabary';
    }
    if (wantAlpha && kind !== 'alphabet' && kind !== 'abjad') kind = 'abjad';
    const id = s.scripts.length;
    const nameId = s.lang.coinName(cu.lang, year, 'script', `scr:${id}`);
    const parts: [string, string][] = [[ref('scr', id), 'script'], [ref('cul', cu.id), 'culture'], [ref('pol', p.id), 'polity']];
    if (source) parts.push([ref('scr', source.id), 'source']);
    const ev = event(s, sub, year, { cell: cap, parts, data: { kind }, sig: sub === 'script-invention' ? 0.55 : 0.2 });
    const sc: Script = { id, nameId, kind, parent: source ? source.id : cur ? cur.id : null, originLang: source ? source.originLang : cu.lang, culture: cu.id, born: year, event: ev.id };
    if (kind === 'alphabet' || kind === 'abjad' || kind === 'syllabary') sc.originLang = source ? source.originLang : cu.lang;
    s.scripts.push(sc);
    cu.script = id;
  }
}
