// Historical omen collections (Bronze to Classical courts): invented signs on the liver, in oil, in the flight of
// birds or in the sky, each paired with a real earlier event of the realm, after the Mesopotamian "historical omen".
// Favourable signs (marks on the right, the king's side) go with the realm's victories; unfavourable ones (on the
// left, the enemy's side) with its defeats and disasters. Only events that had ended before the tablet was copied
// are cited.
import type { Gen } from './gen.ts';
import type { Doc } from '../archive/doc.ts';
import { months } from '../archive/doc.ts';
import type { Polity, SimEvent } from '../sim/state.ts';
import { Rng } from '../core/rng.ts';
import { ordinal } from '../archive/context.ts';
import { alive, literate, med, addDoc } from './genres.ts';
import { titleOf } from './treaty.ts';

type Series = 'liver' | 'oil' | 'birds' | 'sky';
type Kind = 'victory' | 'defeat' | 'death' | 'child' | 'usurp' | 'revolt' | 'famine' | 'plague' | 'darkness' | 'conquest' | 'lost-land' | 'plunder' | 'plundered' | 'city' | 'faith';

interface Omen {
  e: SimEvent;
  kind: Kind;
  good: boolean;
  /** "Dulomin, who routed the army of Bäni near Shivange" (built only for the omens chosen, so that links stay exact) */
  who: () => string;
}

const PREDICTION: Record<Kind, string[]> = {
  victory: ['the weapon of the king will prevail', 'the king will smite the land of his enemy', 'the army of the prince will return laden with spoil'],
  defeat: ['the enemy will scatter the army of the prince', 'the weapon of the enemy will prevail', 'the king will flee before his enemy'],
  death: ['the king will go to his fate', 'the throne will be emptied', 'the prince will sleep with his fathers'],
  child: ['a child will sit upon the throne', 'a young prince will rule, and another will hold his seal'],
  usurp: ['a servant will seize the throne of his lord', 'one who is not the heir will take the throne'],
  revolt: ['the land will rise against the king', 'the cities of the prince will rebel against him'],
  famine: ['the land will go hungry', 'the barley will fail and the people will sell their children', 'the granaries will be empty'],
  plague: ['pestilence will devour the land', 'the god of death will walk in the streets'],
  darkness: ['the sun will be darkened at noon', 'ash will fall upon the fields', 'the day will turn to night'],
  conquest: ['the king will take a land that is not his', 'the prince will set his throne in the palace of his enemy'],
  'lost-land': ['the land of the prince will pass to a stranger', 'the enemy will set his throne in the palace of the king'],
  plunder: ['the king will carry off the treasure of a city', 'the prince will plunder the city of his enemy'],
  plundered: ['the enemy will plunder the city', 'fire will consume the gate of the city'],
  city: ['the king will build a city and dwell in it', 'a new city will be founded and prosper'],
  faith: ['the gods of the land will be changed', 'the king will honour a new god'],
};

const LIVER_PARTS = ['the Station', 'the Path', 'the Finger', 'the Gall-bladder', 'the Palace Gate', 'the Strength', 'the Well-being', 'the Yoke', 'the Throne-base', 'the Weapon'];
const LIVER_GOOD = ['is doubled on the right', 'is long and reaches the Gall-bladder', 'is firm and white', 'bears a Weapon-mark on the right', 'lies to the right', 'is present and well formed', 'rises like a horn on the right', 'is wide on the right side'];
const LIVER_BAD = ['is split on the left', 'is absent', 'is pierced by a hole', 'is covered with a membrane', 'bears a Weapon-mark on the left', 'is dark and swollen', 'lies to the left and is loose', 'is cut through in the middle'];
const OIL_GOOD = ['the oil, poured upon the water, sinks and rises again', 'the oil forms one ring toward the east', 'the oil spreads to the right of the cup', 'the oil divides in two and the right part grows great', 'the oil gathers in the middle like a crown'];
const OIL_BAD = ['the oil divides in two and the left part covers the right', 'the oil forms a bubble that bursts', 'the oil sinks and does not rise', 'the oil spreads to the west and grows thin', 'the oil breaks into many drops toward the left'];
const BIRD_GOOD = ['a falcon passes from the right of a man to his left', 'an eagle circles three times above the palace', 'swallows build their nest above the city gate', 'a raven alights on the right of the army', 'a flock of birds flies toward the enemy'];
const BIRD_BAD = ['a falcon passes from the left of a man to his right', 'a raven cries upon the roof of the palace', 'an owl calls in the throne room', 'a bird falls dead before the gate', 'birds flee from the land of the king'];

export function genOmens(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const eruptions = s.events.filter((e) => e.sub === 'eruption');
  for (const P of s.polities) {
    const r0 = new Rng(s.seed).fork('omens', P.id);
    const last = Math.min(P.died ?? 5000, 5000);
    for (let y = Math.ceil((P.born + 80) / 100) * 100; y < last; y += 100) {
      const r = r0.fork(y);
      if (!r.chance(0.5)) continue;
      const year = Math.min(last - 1, y + r.int(0, 99));
      if (!alive(P, year) || !literate(g, P, year) || ctx.eraAt(P.id, year) > 2) continue;
      collection(g, P, year, eruptions, r);
    }
  }
}

function collection(g: Gen, P: Polity, year: number, eruptions: SimEvent[], r: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const d = g.doc(ctx.polityLang(P, year), year, `omens:${P.id}:${year}`);
  const omens = candidates(g, d, P, year, eruptions);
  if (omens.length < 15) return;
  // variety: draw round-robin across kinds, so battles do not crowd out the rest
  const byKind = new Map<Kind, Omen[]>();
  for (const o of r.shuffle(omens)) {
    const x = byKind.get(o.kind) ?? [];
    x.push(o);
    byKind.set(o.kind, x);
  }
  const want = Math.min(omens.length, r.int(15, 30));
  const ordered: Omen[] = [];
  while (ordered.length < omens.length) {
    for (const x of byKind.values()) if (x.length) ordered.push(x.shift()!);
  }
  const series: Series = r.pick(['liver', 'liver', 'oil', 'birds', 'sky']);
  const era = ctx.eraAt(P.id, year);
  const culture = ctx.polityCulture(P, year);
  const ms = months(ctx, culture);
  const lines: { key: string; text: string }[] = [];
  const said = new Set<string>();
  const chosen: Omen[] = [];
  for (const o of ordered) {
    if (chosen.length >= want) break;
    // two sacks of one city in one reign read as one omen: keep the first (a repeat links nothing new)
    const who = o.who();
    if (said.has(who)) continue;
    said.add(who);
    chosen.push(o);
    const p = protasis(series, o.good, o.kind, r, (i) => ctx.name(ms[i % ms.length], d.lang, year));
    lines.push({ key: p.key, text: `If ${p.text}: ${r.pick(PREDICTION[o.kind])}. It is the omen of ${who}.` });
  }
  if (chosen.length < 15) return;
  // omen series are ordered by the sign, not by history
  const order = lines.map((l, i) => [l, i] as const).sort((a, b) => a[0].key.localeCompare(b[0].key) || a[1] - b[1]);
  const incipit = { liver: ['sheep', 'If the Sheep'], oil: ['water', 'If Oil upon the Water'], birds: ['bird', 'If a Bird'], sky: ['moon', 'When the Moon'] }[series];
  const tablet = r.int(2, 40);
  const seer = g.author(P, 'priest', year);
  const rel = ctx.religionOf(P.id, year);
  const god = rel >= 0 ? s.movements[rel].deities.find((x) => s.deities[x].born <= year) : undefined;
  const reign = ctx.rulerAt(P.id, year);
  const ruler = reign ? s.persons[reign.person] : null;
  const body: string[] = [];
  body.push(`${god !== undefined ? `By the word of ${d.n(`dei:${god}`)}, ${s.deities[god].sex === 'f' ? 'lady' : 'lord'} of the oracle. ` : ''}${incipit[1]} (${d.term(incipit[0])}): tablet ${tablet}, the omens of the kings of former days.`);
  body.push('');
  order.forEach(([l], i) => body.push(`${i + 1}. ${l.text}`));
  body.push('');
  const king = ruler && ruler.born + 12 <= year ? `, for ${d.n(`per:${ruler.id}`)}, ${titleOf(ctx.govAt(P, year), era, ruler.sex === 'f')} of ${d.n(`pol:${P.id}`)}` : '';
  body.push(`${order.length} omens. Tablet ${tablet} of "${incipit[1]}". Written according to its original and checked by ${d.n(`per:${seer.id}`)}, the diviner${king}, ${dateLine(g, d, P, year)}.`);
  // editorial: the record behind each apodosis
  const rows = order.map(([l], i) => {
    const o = chosen[lines.indexOf(l)];
    return `| ${i + 1} | ${d.title(`evt:${o.e.id}`)} | ${o.e.end < o.e.year + 1 ? `AY ${o.e.year}` : `AY ${o.e.year}–${o.e.end}`} | ${o.good ? 'favourable' : 'unfavourable'} |`;
  });
  const span = chosen.map((o) => o.e.year);
  body.push('', '---', '', `**Editorial note.** Every apodosis names an event in the record, the oldest from AY ${Math.min(...span)} and the latest from AY ${Math.max(...span)}, ${year - Math.max(...span)} years before the copy was made. The signs themselves are the diviners' invention. As in other omen series, a mark on the right of the organ or the cup belongs to the king and one on the left to his enemy, and the compilers paired them accordingly with the realm's victories and disasters.`, '', '| Omen | Event in the record | Date | Sign |', '|---|---|---|---|', ...rows);
  const name = g.T.short.get(`pol:${P.id}`);
  addDoc(g, {
    sub: 'omen', year, title: `${incipit[1]}, tablet ${tablet}: historical omens of ${name} (AY ${year})`, author: seer.id, p: P, d, body,
    settlement: ctx.capitalAt(P, year), about: [], m: med(era, 'clay', r),
  });
}

function dateLine(g: Gen, d: Doc, P: Polity, year: number): string {
  const ctx = g.ctx;
  const reign = ctx.rulerAt(P.id, year);
  if (reign && reign.role === 'ruler') return `in the ${ordinal(year - reign.start + 1)} year of ${d.n(`per:${reign.person}`)} [AY ${year}]`;
  return `in the ${ordinal(year - P.born + 1)} year of ${d.n(`pol:${P.id}`)} [AY ${year}]`;
}

function protasis(series: Series, good: boolean, kind: Kind, r: Rng, month: (i: number) => string): { key: string; text: string } {
  if (series === 'liver') {
    const part = r.pick(LIVER_PARTS);
    const feat = r.pick(good ? LIVER_GOOD : LIVER_BAD);
    if (r.chance(0.3)) {
      const part2 = r.pick(LIVER_PARTS.filter((x) => x !== part));
      return { key: part, text: `${part} ${feat} and ${part2} ${r.pick(good ? LIVER_GOOD : LIVER_BAD)}` };
    }
    if (r.chance(0.12)) return { key: part, text: `there are ${good ? 'two Fingers, and the right one is higher' : 'two Fingers, and the left one is higher'}` };
    return { key: part, text: `${part} ${feat}` };
  }
  if (series === 'oil') {
    const t = r.pick(good ? OIL_GOOD : OIL_BAD);
    return { key: t.slice(8, 20), text: t };
  }
  if (series === 'birds') {
    const t = r.pick(good ? BIRD_GOOD : BIRD_BAD);
    return { key: t.split(' ')[1], text: t };
  }
  const m = month(r.int(0, 11));
  const day = r.int(1, 30);
  if (kind === 'darkness') return { key: 'sun', text: `the sun is darkened at noon in the month of ${m} and stars are seen` };
  const goodSky = [`the moon at its appearance wears a crown`, `the sun rises with a halo in the month of ${m}`, `the Bright Star stands in the east at sunrise`, `the moon and the sun are seen together on the ${ordinal(day)} day of ${m}`, `the moon at its appearance has its right horn bright`];
  const badSky = [`the moon is eclipsed on the ${ordinal(day)} day of ${m}`, `the sun rises red as blood`, `a star falls from the east to the west`, `thunder roars in the month of ${m} from a clear sky`, `the moon at its appearance has its left horn dark`];
  const t = r.pick(good ? goodSky : badSky);
  return { key: t.split(' ')[1], text: t };
}

/** Every event of the realm (or at its capital) that a court diviner could cite at `year`. */
function candidates(g: Gen, d: Doc, P: Polity, year: number, eruptions: SimEvent[]): Omen[] {
  const ctx = g.ctx;
  const s = ctx.s;
  const pref = `pol:${P.id}`;
  const capital = ctx.capitalAt(P, year);
  const ids = new Set<number>([...(ctx.eventsByRef.get(pref) ?? []), ...(ctx.eventsByRef.get(`set:${capital}`) ?? [])]);
  const lm = s.world.landmass[s.settlements[capital].cell];
  for (const e of eruptions) if (s.world.landmass[e.cell] === lm) ids.add(e.id);
  const out: Omen[] = [];
  const rulerOf = (pol: number, y: number): number | null => {
    const r = ctx.rulerAt(pol, y);
    return r ? r.person : null;
  };
  const per = (id: number) => d.n(`per:${id}`);
  for (const id of [...ids].sort((a, b) => a - b)) {
    const e = s.events[id];
    if (e.end >= year - 2 || e.year < year - 800 || e.year < P.born - 300) continue;
    const part = (role: string) => e.parts.find(([, x]) => x === role)?.[0];
    const num = (role: string) => {
      const x = part(role);
      return x ? ctx.idNum(x) : -1;
    };
    const ours = (role: string) => part(role) === pref;
    let o: Omen | null = null;
    switch (e.sub) {
      case 'battle': {
        const side = ours('attacker') ? 'attacker' : ours('defender') ? 'defender' : null;
        if (!side) break;
        const enemy = num(side === 'attacker' ? 'defender' : 'attacker');
        const near = part('near');
        const where = () => (near ? ` near ${d.n(near)}` : '');
        const cmd = num(side === 'attacker' ? 'attacking commander' : 'defending commander');
        const foe = num(side === 'attacker' ? 'defending commander' : 'attacking commander');
        const king = rulerOf(P.id, e.year);
        if (enemy < 0 || cmd < 0) break;
        const killed = Number(e.data.commanderKilled ?? -1);
        const leader = () => (king !== null && king !== cmd ? `${per(cmd)}, the general of ${per(king)},` : `${per(cmd)},`);
        if (ours('victor')) o = { e, kind: 'victory', good: true, who: () => `${leader()} who routed the army of ${d.n(`pol:${enemy}`)}${where()}${killed === foe && foe >= 0 ? ` and slew ${per(foe)}` : ''}` };
        else o = { e, kind: 'defeat', good: false, who: () => (killed === cmd ? `${per(cmd)}, who fell before ${d.n(`pol:${enemy}`)}${where()}` : `${leader()} whose army ${d.n(`pol:${enemy}`)} scattered${where()}`) };
        break;
      }
      case 'succession': {
        if (!ours('polity')) break;
        const pred = num('predecessor');
        const succ = num('successor');
        if (pred < 0 || succ < 0 || s.persons[pred].died > e.year + 1) break;
        const regent = num('regent');
        o = regent >= 0
          ? { e, kind: 'child', good: false, who: () => `${per(succ)}, who sat upon the throne of ${per(pred)} as a child, while ${per(regent)} held the seal` }
          : { e, kind: 'death', good: false, who: () => `${per(pred)}, who went to ${s.persons[pred].sex === 'f' ? 'her' : 'his'} fate; ${per(succ)}${d.nameOf(`per:${succ}`) === d.nameOf(`per:${pred}`) ? ', of the same name,' : ''} sat upon the throne` };
        break;
      }
      case 'usurpation': {
        if (!ours('polity')) break;
        const pred = num('predecessor');
        const succ = num('successor');
        if (pred >= 0 && succ >= 0) o = { e, kind: 'usurp', good: false, who: () => `${per(succ)}, who seized the throne of ${d.nameOf(`per:${succ}`) === d.nameOf(`per:${pred}`) ? `${s.persons[succ].sex === 'f' ? 'her' : 'his'} namesake ` : ''}${per(pred)}` };
        break;
      }
      case 'revolt': {
        if (!ours('against')) break;
        const leader = num('leader');
        const king = rulerOf(P.id, e.year);
        if (leader >= 0 && king !== null) o = { e, kind: 'revolt', good: false, who: () => `${per(leader)}, who rose against ${per(king)}` };
        break;
      }
      case 'famine': case 'plague': {
        if (!ours('stricken')) break;
        const king = rulerOf(P.id, e.year);
        if (king === null) break;
        const frac = Number(e.data.fraction ?? e.data.mortality ?? 0);
        const toll = frac >= 0.3 ? 'a third of the people died' : frac >= 0.18 ? 'one in five of the people died' : frac >= 0.08 ? 'one in ten of the people died' : 'many died';
        o = e.sub === 'famine'
          ? { e, kind: 'famine', good: false, who: () => `the famine in the days of ${per(king)}, when ${toll}` }
          : { e, kind: 'plague', good: false, who: () => `the pestilence in the days of ${per(king)}, when ${toll}` };
        break;
      }
      case 'eruption': {
        const king = rulerOf(P.id, e.year);
        if (king === null || e.year < P.born) break;
        o = { e, kind: 'darkness', good: false, who: () => `the year when the mountain burned and the sun was dark, in the days of ${per(king)}` };
        break;
      }
      case 'conquest': {
        const king = rulerOf(P.id, e.year);
        if (king === null) break;
        if (ours('victor')) {
          const v = num('vanquished');
          if (v >= 0) o = { e, kind: 'conquest', good: true, who: () => `${per(king)}, who conquered ${d.n(`pol:${v}`)}` };
        } else if (ours('vanquished')) {
          const v = num('victor');
          if (v >= 0) o = { e, kind: 'lost-land', good: false, who: () => `${per(king)}, whose land ${d.n(`pol:${v}`)} took` };
        }
        break;
      }
      case 'sack': {
        const city = part('settlement');
        const king = rulerOf(P.id, e.year);
        if (!city || king === null) break;
        if (ours('besieger')) o = { e, kind: 'plunder', good: true, who: () => `${per(king)}, who plundered ${d.n(city)}` };
        else if (ours('besieged')) {
          const foe = num('besieger');
          if (foe >= 0) o = { e, kind: 'plundered', good: false, who: () => `${d.n(city)}, which ${d.n(`pol:${foe}`)} plundered in the days of ${per(king)}` };
        }
        break;
      }
      case 'founding-city': {
        const city = part('settlement');
        const king = rulerOf(P.id, e.year);
        if (ours('founder') && city && king !== null) o = { e, kind: 'city', good: true, who: () => `${per(king)}, who built ${d.n(city)}` };
        break;
      }
      case 'conversion': {
        const faith = part('adopted');
        const king = rulerOf(P.id, e.year);
        if (ours('polity') && faith && king !== null) o = { e, kind: 'faith', good: true, who: () => `${per(king)}, who turned to the ${d.n(faith)}` };
        break;
      }
    }
    if (o) out.push(o);
  }
  return out;
}
