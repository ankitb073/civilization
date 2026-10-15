// What survives to the modern era, in what condition, where it was found and who translated it.
import type { Gen, Artifact } from './gen.ts';
import { archiveEvent } from './gen.ts';
import { Rng } from '../core/rng.ts';

export function applySurvival(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const rng = new Rng(s.seed).fork('survival');
  // sacks that burned archives, per settlement
  const burned = new Map<number, number[]>();
  for (const e of s.events) {
    if (e.sub !== 'sack' || !e.data.burnedArchives) continue;
    const t = e.parts.find(([, r]) => r === 'settlement')?.[0];
    if (!t) continue;
    const id = ctx.idNum(t);
    if (!burned.has(id)) burned.set(id, []);
    burned.get(id)!.push(e.year);
  }
  const excavations = new Map<number, { year: number; by: number; event: number }>(); // settlement -> excavation
  for (const a of g.artifacts) {
    const age = 5000 - a.year;
    let p = a.durable * Math.exp(-age / a.tau);
    if (a.seat !== null && a.durable < 0.6) {
      const fires = (burned.get(a.seat) ?? []).filter((y) => y >= a.year);
      if (fires.length) p *= 0.15;
    }
    p = Math.min(0.97, p * 1.6);
    const r = rng.fork(a.id);
    if (!r.chance(p)) {
      a.status = 'lost';
      continue;
    }
    // condition
    const wear = 1 - Math.exp(-age / 2500);
    if (a.interlinear) {
      a.condition = a.interlinear.translation.endsWith('[...]') ? 'Damaged; the final lines are lost.' : wear > 0.5 ? 'Weathered but legible.' : 'Complete.';
    } else if (r.chance(wear * 0.5)) {
      a.condition = r.pick(['Fragmentary; gaps marked [...].', 'Damaged by fire at the edges.', 'Several leaves missing.', 'Water-stained; partly illegible.']);
      a.body = lacunae(a.body, r);
    } else {
      a.condition = age > 1500 ? 'Complete, with minor losses.' : 'Complete.';
    }
    // provenance
    const durableMedium = a.durable >= 0.6 && a.sub !== 'newspaper' && a.sub !== 'telegram' && a.sub !== 'yearbook' && a.sub !== 'market' && a.sub !== 'debate' && a.sub !== 'paper' && a.sub !== 'pamphlet';
    if (a.year >= 4500) {
      a.provenance = `State archive of ${refName(g, a.polity)}; catalogued AY ${Math.min(4999, a.year + r.int(1, 40))}.`;
      a.foundYear = null;
    } else if (durableMedium && a.year < 3800) {
      const site = a.settlement ?? nearestSite(g, a.cell);
      let ex = site !== null ? excavations.get(site) : undefined;
      if (site !== null && !ex) {
        const by = g.scholarFor(a.lang, 4900, 'archaeologist');
        const sp = s.persons[by];
        const year = r.int(Math.max(4790, sp.born + 25), Math.max(Math.max(4790, sp.born + 25), Math.min(4985, sp.died - 3)));
        const t = s.settlements[site];
        const ev = archiveEvent(g, 'excavation', year, t.cell, [[`set:${site}`, 'site'], [`per:${by}`, 'excavator']], [], {}, 0.12);
        ex = { year, by, event: ev };
        excavations.set(site, ex);
      }
      if (ex && site !== null) {
        a.foundYear = ex.year;
        a.provenance = `Excavated at ${g.T.short.get(`set:${site}`)} in AY ${ex.year} by ${g.T.short.get(`per:${ex.by}`)}.`;
        a.mentions.add(`evt:${ex.event}`);
        a.mentions.add(`per:${ex.by}`);
        a.mentions.add(`set:${site}`);
        s.events[ex.event].data.finds = ((s.events[ex.event].data.finds as number) ?? 0) + 1;
      } else {
        a.foundYear = r.int(4790, 4985);
        a.provenance = `Chance find, AY ${a.foundYear}.`;
      }
    } else {
      const lib = a.seat !== null ? a.seat : null;
      a.provenance = lib !== null
        ? `${r.pick(['Temple library', 'Monastery library', 'Palace archive', 'Cathedral archive', 'University library'])} at ${g.T.short.get(`set:${lib}`)}; ${a.year < 3000 ? 'medieval copy' : 'original'}.`
        : 'Private collection; origin uncertain.';
      if (lib !== null) a.mentions.add(`set:${lib}`);
    }
    // translator: everything not in the editorial language
    if (a.lang !== ctx.editorialLang || a.year < 4600) {
      a.translator = g.scholarFor(a.lang, Math.max(a.foundYear ?? 4850, 4850), 'translator');
      a.mentions.add(`per:${a.translator}`);
    }
  }
}

function refName(g: Gen, polity: number | null): string {
  return polity === null ? 'unknown provenance' : g.T.short.get(`pol:${polity}`) ?? '';
}

function nearestSite(g: Gen, cell: number): number | null {
  const s = g.ctx.s;
  let best: number | null = null, bd = Infinity;
  for (const t of s.settlements) {
    const d = Math.hypot(s.world.x[t.cell] - s.world.x[cell], s.world.y[t.cell] - s.world.y[cell]);
    if (d < bd) { bd = d; best = t.id; }
  }
  return bd < 120 ? best : null;
}

/** Knock holes in a body of text without breaking links, headings or tables. */
function lacunae(body: string, r: Rng): string {
  const lines = body.split('\n');
  let holes = r.int(1, 3);
  for (let i = 0; i < lines.length && holes > 0; i++) {
    const L = lines[i];
    if (!L || L.startsWith('#') || L.startsWith('---') || L.startsWith('**Editorial') || L.startsWith('|') || L.startsWith('- ') || L.startsWith('*')) continue;
    if (!r.chance(0.35)) continue;
    const parts = L.split(/(\[\[[^\]]+\]\])/);
    const plain = parts.map((p, k) => [p, k] as const).filter(([p]) => !p.startsWith('[[') && p.split(' ').filter(Boolean).length >= 6);
    if (plain.length === 0) continue;
    const [text, k] = r.pick(plain);
    const words = text.split(' ');
    const start = r.int(1, Math.max(1, words.length - 4));
    words.splice(start, r.int(2, 3), '[...]');
    parts[k] = words.join(' ');
    lines[i] = parts.join('');
    holes--;
  }
  return lines.join('\n');
}

export type { Artifact };
