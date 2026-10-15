// Diplomacy: opinion drift, alliances against common rivals, dynastic marriages, vassal annexation.
import type { State } from './state.ts';
import { event, ref, rel, alivePolity, setOwner } from './state.ts';
import type { PolityAgg } from './polities.ts';
import { endPolity } from './polities.ts';
import { marriageBetween, atWar } from './war.ts';

export function diplomacyStep(s: State, agg: PolityAgg, y0: number): void {
  const rng = s.rng.fork('diplomacy', y0);
  const alive = s.polities.filter((p) => alivePolity(p, y0));
  // opinion drift along borders
  for (const p of alive) {
    const nb = agg.borders.get(p.id);
    if (!nb) continue;
    for (const [q, len] of nb) {
      if (q < p.id) continue;
      const P = p, Q = s.polities[q];
      if (!alivePolity(Q, y0)) continue;
      const r = rel(s, P.id, Q.id);
      let d = -0.03 * Math.min(4, len / 6);
      d += P.religion === Q.religion ? 0.02 : -0.04;
      d += s.cultures[P.culture].lang === s.cultures[Q.culture].lang ? 0.02 : 0;
      d += rng.normal(0, 0.08);
      r.opinion = Math.max(-1, Math.min(1, r.opinion * 0.9 + d));
    }
  }
  // alliances: friendly neighbours with a common rival
  for (const p of alive) {
    if (p.kind === 'rebel') continue;
    const nb = agg.borders.get(p.id);
    if (!nb) continue;
    for (const q of nb.keys()) {
      if (q <= p.id) continue;
      const Q = s.polities[q];
      if (!alivePolity(Q, y0) || Q.kind === 'rebel') continue;
      const r = rel(s, p.id, q);
      if (r.alliance !== null) {
        // alliances lapse when opinion sours or after 60 years
        const started = s.events[r.alliance].year;
        if (r.opinion < -0.1 || y0 - started > 60) {
          const year = y0 + rng.int(0, 9);
          event(s, 'alliance-lapse', year, { parts: [[ref('pol', p.id), 'party'], [ref('pol', q), 'party']], causes: [r.alliance], sig: 0.05 });
          r.alliance = null;
        }
        continue;
      }
      if (r.opinion < 0.25) continue;
      // common rival
      let rival = -1;
      for (const [k, rr] of s.relations) {
        if (rr.opinion > -0.35) continue;
        const a = Math.floor(k / 65536), b = k % 65536;
        const other = a === p.id ? b : b === p.id ? a : -1;
        if (other < 0 || other === q) continue;
        if (rel(s, q, other).opinion < -0.2) { rival = other; break; }
      }
      if (rival < 0 || !alivePolity(s.polities[rival], y0)) continue;
      if (!rng.chance(0.3)) continue;
      const year = y0 + rng.int(0, 9);
      const parts: [string, string][] = [[ref('pol', p.id), 'party'], [ref('pol', q), 'party'], [ref('pol', rival), 'against']];
      if (p.ruler !== null) parts.push([ref('per', p.ruler), 'signatory']);
      if (Q.ruler !== null) parts.push([ref('per', Q.ruler), 'signatory']);
      const ev = event(s, 'treaty', year, {
        cell: s.settlements[p.capital].cell, parts, data: { kind: 'alliance', terms: [{ kind: 'alliance', years: 30 }], against: rival }, sig: 0.22,
      });
      r.alliance = ev.id;
      r.opinion = Math.min(1, r.opinion + 0.15);
    }
  }
  // dynastic marriages between friendly houses
  for (const p of alive) {
    if (p.dynasty === null || p.ruler === null) continue;
    const nb = agg.borders.get(p.id);
    if (!nb) continue;
    for (const q of nb.keys()) {
      if (q <= p.id) continue;
      const Q = s.polities[q];
      if (!alivePolity(Q, y0) || Q.dynasty === null || Q.ruler === null) continue;
      const r = rel(s, p.id, q);
      if (r.opinion < 0.1 || !rng.chance(0.08)) continue;
      const year = y0 + rng.int(0, 9);
      const m = marriageBetween(s, p, Q, year, rng);
      if (!m) continue;
      event(s, 'marriage', year, {
        cell: s.settlements[p.capital].cell,
        parts: [[ref('per', m[0]), 'spouse'], [ref('per', m[1]), 'spouse'], [ref('pol', p.id), 'house'], [ref('pol', q), 'house']],
        sig: 0.1,
      });
      r.opinion = Math.min(1, r.opinion + 0.12);
    }
  }
  // peaceful annexation of long-standing vassals
  for (const p of alive) {
    if (p.overlord === null) continue;
    const o = s.polities[p.overlord];
    if (!alivePolity(o, y0)) { p.overlord = null; continue; }
    if (atWar(s, p.id).length || atWar(s, o.id).length) continue;
    if (p.cells > o.cells / 3) {
      if (o.stability < 0.3 && rng.chance(0.15)) {
        const year = y0 + rng.int(0, 9);
        event(s, 'repudiation', year, { parts: [[ref('pol', p.id), 'vassal'], [ref('pol', o.id), 'overlord']], sig: 0.2 });
        p.overlord = null;
      }
      continue;
    }
    if (s.cultures[p.culture].lang === s.cultures[o.culture].lang && rng.chance(0.05)) {
      const year = Math.max(y0 + rng.int(0, 9), s.lastLogYear.territory);
      if (year > y0 + 9) continue;
      const ev = event(s, 'annexation', year, { cell: s.settlements[p.capital].cell, parts: [[ref('pol', p.id), 'annexed'], [ref('pol', o.id), 'overlord']], sig: 0.3 });
      // territory changes must be logged in year order: annex at the decade boundary
      const cells = agg.cells.get(p.id) ?? [];
      void cells;
      pendingAnnex.push({ vassal: p.id, overlord: o.id, event: ev.id, year });
    }
  }
}

/** Annexations are applied at the start of the next yearly loop to keep the territory log ordered. */
export const pendingAnnex: { vassal: number; overlord: number; event: number; year: number }[] = [];

export function applyPendingAnnex(s: State, year: number): void {
  for (let i = pendingAnnex.length - 1; i >= 0; i--) {
    const a = pendingAnnex[i];
    if (a.year !== year) continue;
    pendingAnnex.splice(i, 1);
    const p = s.polities[a.vassal];
    const o = s.polities[a.overlord];
    if (!alivePolity(p, year) || !alivePolity(o, year)) continue;
    for (let c = 0; c < s.world.n; c++) if (s.owner[c] === p.id) setOwner(s, c, o.id, year, a.event);
    endPolity(s, p, year, a.event);
  }
}
