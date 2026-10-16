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
    // a flagship's condition and provenance are drawn from its own frozen id, so a change to the generated archive
    // (which shifts every later artifact id) never re-rolls what its essays and the History say about it
    const r = a.flagship ? rng.fork('flagship', String(a.data?.flagshipId ?? a.id)) : rng.fork(a.id);
    if (!a.flagship && !r.chance(p)) {
      a.status = 'lost';
      continue;
    }
    // condition
    const wear = 1 - Math.exp(-age / 2500);
    if (a.interlinear) {
      a.condition = a.interlinear.translation.endsWith('[...]') ? 'Damaged; the final lines are lost.' : wear > 0.5 ? 'Weathered but legible.' : 'Complete.';
    } else if (a.sub === 'coin') {
      a.condition = r.pick(['Extremely fine.', 'Very fine.', 'Fine; legend partly off the flan.', 'Worn, but the portrait is clear.', 'Corroded; weight slightly reduced.']);
    } else if (r.chance(wear * 0.5)) {
      a.condition = r.pick(['Fragmentary; gaps marked [...].', 'Damaged by fire at the edges.', 'Several leaves missing.', 'Water-stained; partly illegible.']);
      a.body = lacunae(a.body, r);
      // the condition must not promise gaps the text does not show
      if (a.condition.startsWith('Fragmentary') && !a.body.split('\n---\n')[0].includes('[...]')) a.condition = 'Damaged by fire at the edges.';
    } else {
      a.condition = age > 1500 ? 'Complete, with minor losses.' : 'Complete.';
    }
    // provenance
    const durableMedium = a.durable >= 0.6 && a.sub !== 'newspaper' && a.sub !== 'telegram' && a.sub !== 'yearbook' && a.sub !== 'market' && a.sub !== 'debate' && a.sub !== 'paper' && a.sub !== 'pamphlet';
    if (a.year >= 4500 && a.sub !== 'graffito') {
      a.provenance = `State archive of ${refName(g, a.polity)}; catalogued AY ${Math.min(4999, a.year + r.int(1, 40))}.`;
      a.foundYear = null;
      a.foundAt = a.seat;
      a.foundHow = 'library';
    } else if ((durableMedium || a.sub === 'graffito') && (a.year < 3800 || a.sub === 'inscription' || a.sub === 'coin' || a.sub === 'graffito')) {
      const site = a.settlement ?? nearestSite(g, a.cell, a.year);
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
      if (ex && site !== null && ex.year <= a.year + 5) {
        // the dig came before (or hard on) the object's own date: it stands where it was made
        const seen = Math.min(4999, a.year + r.int(0, 20));
        a.foundYear = null;
        a.foundAt = site;
        a.foundHow = 'in situ';
        a.provenance = `${a.sub === 'graffito' ? 'Recorded' : 'Catalogued'} in situ at ${g.T.short.get(`set:${site}`)}, AY ${seen}.`;
      } else if (ex && site !== null) {
        a.foundYear = ex.year;
        a.foundAt = site;
        a.foundHow = 'excavated';
        a.provenance = `Excavated at ${g.T.short.get(`set:${site}`)} in AY ${ex.year} by ${g.T.short.get(`per:${ex.by}`)}.`;
        a.mentions.add(`evt:${ex.event}`);
        a.mentions.add(`per:${ex.by}`);
        a.mentions.add(`set:${site}`);
        s.events[ex.event].data.finds = ((s.events[ex.event].data.finds as number) ?? 0) + 1;
      } else {
        a.foundYear = Math.min(4999, Math.max(a.year + 5, r.int(4790, 4985)));
        a.foundHow = 'chance';
        a.provenance = `Chance find, AY ${a.foundYear}.`;
      }
    } else {
      const lib = a.seat !== null ? a.seat : null;
      a.provenance = lib !== null
        ? `${r.pick(['Temple library', 'Monastery library', 'Palace archive', 'Cathedral archive', 'University library'])} at ${g.T.short.get(`set:${lib}`)}; ${a.year < 3000 ? 'medieval copy' : 'original'}.`
        : 'Private collection; origin uncertain.';
      if (lib !== null) {
        a.mentions.add(`set:${lib}`);
        a.foundAt = lib;
        a.foundHow = 'library';
      }
    }
    // translator: everything not in the editorial language
    if (a.lang !== ctx.editorialLang || a.year < 4600) {
      a.translator = g.scholarFor(a.lang, Math.max(a.foundYear ?? 4850, 4850), 'translator');
      // a text written after its translator's death goes to a scholar active after it was written
      if (ctx.s.persons[a.translator].died < a.year) a.translator = g.scholarFor(a.lang, a.year, 'translator');
      a.mentions.add(`per:${a.translator}`);
    }
  }
}

function refName(g: Gen, polity: number | null): string {
  return polity === null ? 'unknown provenance' : g.T.short.get(`pol:${polity}`) ?? '';
}

function nearestSite(g: Gen, cell: number, year: number): number | null {
  const s = g.ctx.s;
  let best: number | null = null, bd = Infinity;
  for (const t of s.settlements) {
    if (t.founded > year) continue;
    const d = Math.hypot(s.world.x[t.cell] - s.world.x[cell], s.world.y[t.cell] - s.world.y[cell]);
    if (d < bd) { bd = d; best = t.id; }
  }
  return bd < 120 ? best : null;
}

/** Knock holes in a body of text without breaking links, headings or tables. */
function lacunae(body: string, r: Rng): string {
  const lines = body.split('\n');
  // the modern editorial apparatus below the first rule is not part of the object: decay never touches it
  // (the draws are still made, so every other document keeps its holes where they were)
  const apparatus = lines.indexOf('---');
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
    if (apparatus < 0 || i < apparatus) lines[i] = parts.join('');
    holes--;
  }
  return lines.join('\n');
}

export type { Artifact };
