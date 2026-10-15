// Fragments: some lost works survive only as quotations in later works. After survival, a lost
// chronicle, annal, treaty or scripture may be quoted by a later surviving document of the same
// tradition; the lost work then gets a page of its own holding just the quoted fragment.
import type { Gen, Artifact } from './gen.ts';
import { Rng } from '../core/rng.ts';

const QUOTABLE = new Set(['chronicle', 'annals', 'treaty', 'scripture', 'treatise', 'decree', 'record']);
const QUOTERS = new Set(['chronicle', 'annals', 'treatise', 'scripture', 'paper', 'travelogue']);

export function applyFragments(g: Gen): number {
  const ctx = g.ctx;
  const s = ctx.s;
  const rng = new Rng(s.seed).fork('fragments');
  // later surviving works, indexed by the cultural tradition (root language family) they belong to
  const quoters = g.artifacts.filter((a) => a.status === 'extant' && QUOTERS.has(a.sub) && !a.flagship);
  const famOf = (a: Artifact) => s.lang.info(a.lang).family;
  const byFam = new Map<number, Artifact[]>();
  for (const q of quoters) {
    const f = famOf(q);
    if (!byFam.has(f)) byFam.set(f, []);
    byFam.get(f)!.push(q);
  }
  const used = new Set<number>();
  let n = 0;
  for (const L of g.artifacts) {
    if (L.status !== 'lost' || !QUOTABLE.has(L.sub) || L.year > 4300) continue;
    const r = rng.fork(L.id);
    if (!r.chance(0.065)) continue;
    // a later work of the same tradition that deals with the same states, places or regions
    const topics = [...L.mentions].filter((m) => m.startsWith('pol:') || m.startsWith('set:') || m.startsWith('reg:'));
    if (!topics.length) continue;
    const cands = (byFam.get(famOf(L)) ?? []).filter((q) => q.year > L.year + 30 && q.year < L.year + 900 && !used.has(q.id) && topics.some((t) => q.mentions.has(t)));
    if (!cands.length) continue;
    const Q = r.pick(cands);
    const text = L.body.split('\n---\n')[0];
    const sentences = text.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 40 && x.length < 420 && !x.startsWith('#') && !x.startsWith('|') && !x.startsWith('*') && !x.startsWith('-') && !x.startsWith('>'));
    if (!sentences.length) continue;
    const start = r.int(0, Math.max(0, sentences.length - 2));
    const frag = sentences.slice(start, start + r.int(1, 2)).join(' ');
    used.add(Q.id);
    n++;
    // the quoting work: a passage citing the lost one, before its editorial apparatus
    const [qText, ...qRest] = Q.body.split('\n---\n');
    const intro = r.pick(['As it is written in', 'So say the old books, in', 'We read in', 'In the words of']);
    const quote = `\n\n${intro} the *[[art:${L.id}|${L.title}]]*:\n\n> ${frag}`;
    Q.body = qText.trimEnd() + quote + (qRest.length ? `\n\n---\n${qRest.join('\n---\n')}` : '') + `\n\n*Fragment:* the passage quoted from the ${L.title} is the only surviving witness to that work.`;
    // the lost work survives as a fragment page
    L.status = 'extant';
    L.condition = 'Lost; survives only as a fragment quoted in a later work.';
    L.provenance = `Fragment preserved in ${Q.title} (${Q.catalog}, AY ${Q.year}).`;
    L.foundYear = null;
    L.body = `> ${frag}\n\n---\n\n**Editorial note.** The ${L.title} is lost. This fragment survives because it was quoted in [[art:${Q.id}|${Q.title}]], written ${Q.year - L.year} years later. The rest of the work is unknown.`;
    L.translator = Q.translator;
    L.interlinear = undefined;
    L.ledger = undefined;
    L.mentions = new Set([...L.mentions].filter((m) => frag.includes(m)));
  }
  return n;
}
