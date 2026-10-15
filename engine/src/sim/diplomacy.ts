// Diplomacy: opinion drift, alliances against common rivals, dynastic marriages, vassal annexation.
import type { State } from './state.ts';
import { event, ref, rel, alivePolity, setOwner } from './state.ts';
import type { PolityAgg } from './polities.ts';
import { endPolity } from './polities.ts';
import { marriageBetween, atWar } from './war.ts';

export function diplomacyStep(s: State, agg: PolityAgg, year: number): void {
  const y0 = year;
  const rng = s.rng.fork('diplomacy', year);
  const alive = s.polities.filter((p) => alivePolity(p, y0));
  const decadal = year % 10 === 0;
  // rivals per polity (opinion below -0.35), computed once
  const rivals = new Map<number, number[]>();
  for (const [k, rr] of s.relations) {
    if (rr.opinion > -0.35) continue;
    const a = Math.floor(k / 65536), b = k % 65536;
    if (!rivals.has(a)) rivals.set(a, []);
    if (!rivals.has(b)) rivals.set(b, []);
    rivals.get(a)!.push(b);
    rivals.get(b)!.push(a);
  }
  // opinion drift along borders (once a decade)
  for (const p of decadal ? alive : []) {
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
          event(s, 'alliance-lapse', year, { parts: [[ref('pol', p.id), 'party'], [ref('pol', q), 'party']], causes: [r.alliance], sig: 0.05 });
          r.alliance = null;
        }
        continue;
      }
      if (r.opinion < 0.25) continue;
      // common rival
      let rival = -1;
      for (const other of rivals.get(p.id) ?? []) {
        if (other === q) continue;
        if (rel(s, q, other).opinion < -0.2 && alivePolity(s.polities[other], y0)) { rival = other; break; }
      }
      if (rival < 0) continue;
      if (!rng.chance(0.03)) continue;
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
      if (r.opinion < 0.1 || !rng.chance(0.008)) continue;
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
    if (!alivePolity(o, y0) || !alivePolity(p, y0)) { p.overlord = null; continue; }
    if (atWar(s, p.id).length || atWar(s, o.id).length) continue;
    if (p.cells > o.cells / 3) {
      if (o.stability < 0.3 && rng.chance(0.015)) {
        event(s, 'repudiation', year, { parts: [[ref('pol', p.id), 'vassal'], [ref('pol', o.id), 'overlord']], sig: 0.2 });
        p.overlord = null;
      }
      continue;
    }
    if (s.cultures[p.culture].lang === s.cultures[o.culture].lang && rng.chance(0.005)) {
      const ev = event(s, 'annexation', year, { cell: s.settlements[p.capital].cell, parts: [[ref('pol', p.id), 'annexed'], [ref('pol', o.id), 'overlord']], sig: 0.3 });
      for (let c = 0; c < s.world.n; c++) if (s.owner[c] === p.id) setOwner(s, c, o.id, year, ev.id);
      endPolity(s, p, year, ev.id);
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
