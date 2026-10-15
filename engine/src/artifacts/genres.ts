// Everyday genres: lawsuits, merchants' wills, muster rolls, port registers, loanword glossaries,
// school exercises, almanacs and graffiti. Each is grounded in the record (owners, prices, armies,
// routes, languages, rulers, climate) and dated so that it mentions nothing that did not yet exist.
import type { Gen } from './gen.ts';
import { fmt, goodName, goodUnit } from './gen.ts';
import { localDate, months } from '../archive/doc.ts';
import type { Doc } from '../archive/doc.ts';
import type { Polity, SimEvent } from '../sim/state.ts';
import type { Term } from '../sim/war.ts';
import { Rng } from '../core/rng.ts';
import { GOODS } from '../sim/economy.ts';
import { fmtPrice, houseLabel } from './ledger.ts';
import { cap, ordinal } from '../archive/context.ts';
import { domainPhrase } from '../archive/naming.ts';

const GRAIN = GOODS.findIndex((x) => x.key === 'grain');

export const QTY: Record<string, [number, number]> = {
  grain: [40, 900], salt: [10, 200], copper: [20, 400], tin: [5, 80], bronze: [20, 200], iron: [20, 500], cloth: [10, 300],
  timber: [20, 400], horses: [2, 30], spice: [2, 60], oil: [20, 300], gold: [1, 6], coal: [100, 4000], steel: [10, 600],
  petroleum: [100, 8000], machinery: [2, 40],
};

export function genGenres(g: Gen): void {
  genLawsuits(g);
  genWills(g);
  genMusterRolls(g);
  genManifests(g);
  genGlossaries(g);
  genExercises(g);
  genAlmanacs(g);
  genGraffiti(g);
}

// ---------------------------------------------------------------- shared helpers
export function alive(p: Polity, year: number): boolean {
  return p.born <= year && (p.died === null || p.died > year);
}

export function literate(g: Gen, p: Polity, year: number): boolean {
  return g.ctx.scriptOf(p, year) >= 0;
}

export function med(era: number, kind: 'clay' | 'soft' | 'stone' | 'print', r: Rng): { medium: string; durable: number; tau: number } {
  if (kind === 'stone') return { medium: 'stone', durable: 0.8, tau: 5000 };
  if (era <= 1) return { medium: 'clay tablet', durable: 0.7, tau: 3500 };
  if (kind === 'clay') return r.pick([{ medium: 'wax tablet', durable: 0.3, tau: 1200 }, { medium: 'potsherd', durable: 0.7, tau: 4000 }, { medium: 'clay tablet', durable: 0.65, tau: 3500 }]);
  if (era <= 3) return r.chance(0.5) ? { medium: 'parchment', durable: 0.35, tau: 1500 } : { medium: 'papyrus', durable: 0.25, tau: 1200 };
  if (era === 4) return { medium: kind === 'print' ? 'printed sheet' : 'paper', durable: 0.55, tau: 2500 };
  return { medium: kind === 'print' ? 'printed sheet' : 'typescript', durable: 0.85, tau: 6000 };
}

/** An ordinary person's name, unlinked: realized in the document's language. */
export function commoner(g: Gen, d: Doc, culture: number, year: number, key: string, female = false): string {
  const s = g.ctx.s;
  const lang = s.cultures[culture].lang;
  const born = Math.max(year - 30, s.lang.info(lang).born);
  const id = s.lang.coinName(lang, born, female ? 'person-f' : 'person-m', `commoner:${key}`);
  return g.ctx.name(id, d.lang, year);
}

export function units(qty: number, gd: number): string {
  const u = goodUnit(gd);
  return `${fmt(qty)} ${u}${qty === 1 || u === 'head' ? '' : 's'}`;
}

export function money(g: Gen, d: Doc, grams: number, polity: number, year: number): string {
  const ctx = g.ctx;
  const cur = ctx.currencyAt(polity, year);
  if (cur < 0 || ctx.s.currencies[cur].born > year) return `${fmt(grams / 8.3)} shekels of silver`;
  return `${fmtPrice(grams / ctx.contentAt(cur, year))} ${d.link(`cur:${cur}`, d.nameOf(`cur:${cur}`))}`;
}

export function grainGrams(g: Gen, settlement: number, year: number): number {
  return g.price(settlement, GRAIN, year) ?? 8;
}

export function capitalAlive(g: Gen, p: Polity, year: number): number {
  return g.ctx.capitalAt(p, Math.min(year, (p.died ?? 5000) - 1));
}

export function addDoc(g: Gen, o: {
  sub: string; year: number; title: string; author: number | null; p: Polity; d: Doc; body: string[]; settlement: number | null; cell?: number;
  about: number[]; m: { medium: string; durable: number; tau: number };
}): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const seat = o.settlement ?? capitalAlive(g, o.p, o.year);
  g.add({
    sub: o.sub, year: o.year, title: o.title, author: o.author, polity: o.p.id, lang: o.d.lang, script: ctx.scriptOf(o.p, o.year), medium: o.m.medium,
    cell: o.cell ?? s.settlements[seat].cell, settlement: o.settlement, about: o.about, body: o.body.join('\n'), mentions: o.d.mentions,
    dateText: localDate(ctx, o.d, o.p, o.year), flagship: false, durable: o.m.durable, tau: o.m.tau, seat,
  });
}

// ---------------------------------------------------------------- 1. court records
function genLawsuits(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const e of s.events) {
    if (e.sub === 'treaty') {
      const cede = ((e.data.terms as Term[] | undefined) ?? []).find((t) => t.kind === 'cede' && t.to !== undefined && t.from !== undefined);
      if (!cede) continue;
      const r = new Rng(s.seed).fork('suit-land', e.id);
      if (!r.chance(0.35)) continue;
      landSuit(g, e, cede, r);
    } else if (e.sub === 'bankruptcy') {
      const r = new Rng(s.seed).fork('suit-debt', e.id);
      if (!r.chance(0.7)) continue;
      debtSuit(g, e, r);
    } else if (e.sub === 'usurpation') {
      const r = new Rng(s.seed).fork('suit-heir', e.id);
      if (!r.chance(0.6)) continue;
      inheritanceSuit(g, e, r);
    }
  }
}

function courtHeader(g: Gen, d: Doc, P: Polity, seat: number, year: number, era: number): string {
  return era >= 4
    ? `In the court of ${d.n(`set:${seat}`)}, ${localDate(g.ctx, d, P, year)}.`
    : `Record of the court sitting at ${d.n(`set:${seat}`)}, ${localDate(g.ctx, d, P, year)}.`;
}

function judgeName(g: Gen, d: Doc, P: Polity, year: number, era: number, key: string): string {
  const r = g.ctx.rulerAt(P.id, year);
  if (era <= 2 && r) {
    const ruler = g.ctx.s.persons[r.person];
    if (ruler.born + 16 <= year && ruler.died >= year) return `the king ${d.n(`per:${ruler.id}`)}`;
  }
  return `the judge ${commoner(g, d, g.ctx.polityCulture(P, year), year, `judge:${key}`)}`;
}

function landSuit(g: Gen, e: SimEvent, cede: Term, r: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const year = Math.min(4999, e.year + r.int(1, 12));
  const P = s.polities[cede.to!];
  const L = s.polities[cede.from!];
  if (!alive(P, year) || !literate(g, P, year) || L.born > year) return;
  const towns = (cede.settlements ?? []).filter((t) => s.settlements[t].founded <= year && (s.settlements[t].abandoned ?? 9999) > year && ctx.ownerAt(s.settlements[t].cell, year) === P.id);
  const seat = towns.length ? r.pick(towns) : capitalAlive(g, P, year);
  const region = s.world.region[(cede.cells ?? [s.settlements[seat].cell])[0]];
  const lang = ctx.polityLang(P, year);
  const d = g.doc(lang, year, `suit-land:${e.id}`);
  const era = ctx.eraAt(P.id, year);
  const plaintiff = commoner(g, d, ctx.polityCulture(L, Math.min(year, (L.died ?? 5000) - 1)), year, `plaintiff:${e.id}`);
  const father = commoner(g, d, ctx.polityCulture(L, Math.min(year, (L.died ?? 5000) - 1)), year - 30, `pfather:${e.id}`);
  const fields = r.int(4, 60) * 5;
  const rentGrams = grainGrams(g, seat, year) * r.int(8, 30);
  const judge = judgeName(g, d, P, year, era, `land:${e.id}`);
  const verdict = r.pick(['dismissed', 'rent', 'compensation'] as const);
  const lines: string[] = [courtHeader(g, d, P, seat, year, era), ''];
  lines.push(`${plaintiff}, son of ${father}, ${era >= 4 ? 'formerly a subject of' : 'a man of'} ${d.n(`pol:${L.id}`)}, came before ${judge} and said: "The fields of my father in ${d.n(`reg:${region}`)}, ${fields} ${era >= 4 ? 'acres' : 'measures of sown land'}, were taken from us when the land was given to ${d.n(`pol:${P.id}`)} by the ${d.n(`evt:${e.id}`)}. I ask that they be returned to me."`);
  lines.push('');
  lines.push(`${era >= 4 ? 'Counsel for the Crown' : 'The steward of the royal lands'} answered: "By the ${d.n(`evt:${e.id}`)} the land of ${d.n(`reg:${region}`)} belongs to ${d.n(`pol:${P.id}`)}. ${r.pick(['No private claim survives the treaty.', 'The plaintiff did not swear allegiance within the year.', 'The fields were found empty and were given to settlers.'])}"`);
  lines.push('');
  if (verdict === 'dismissed') lines.push(`**Judgment.** The claim is dismissed. ${r.pick(['What the gods and the treaty have given, no court may take back.', 'The plaintiff shall pay the costs of the court.', 'Let him seek his fields in the land of his former lord.'])}`);
  else if (verdict === 'rent') lines.push(`**Judgment.** The plaintiff may keep the fields as a tenant of the crown, paying each year ${money(g, d, rentGrams, P.id, year)}${era <= 3 ? ', at the harvest' : ''}.`);
  else lines.push(`**Judgment.** The fields remain with the crown; the plaintiff shall receive ${money(g, d, rentGrams * 6, P.id, year)} in compensation.`);
  lines.push('');
  const wits = [...new Set([0, 1, 2, 3, 4].map((i) => commoner(g, d, ctx.polityCulture(P, year), year, `wit:${e.id}:${i}`)))].slice(0, 3);
  lines.push(`Witnesses: ${wits.join(', ')}.`);
  lines.push('', '---', '', `**Editorial note.** A private consequence of the ${d.title(`evt:${e.id}`)}, by which ${d.ed(`pol:${L.id}`)} ceded ${(cede.cells ?? []).length} districts to ${d.ed(`pol:${P.id}`)}.`);
  const author = g.author(P, 'scribe', year);
  addDoc(g, { sub: 'lawsuit', year, title: `Lawsuit over fields in ${g.T.short.get(`reg:${region}`)} after the ${g.T.short.get(`evt:${e.id}`)}`, author: author.id, p: P, d, body: lines, settlement: seat, about: [e.id], m: med(era, 'soft', r) });
}

function debtSuit(g: Gen, e: SimEvent, r: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const hr = e.parts.find(([, role]) => role === 'house')?.[0];
  if (!hr) return;
  const h = s.houses[ctx.idNum(hr)];
  const year = Math.min(4999, e.year + r.int(0, 2));
  const seat = h.settlement;
  const o = ctx.ownerAt(s.settlements[seat].cell, year);
  if (o < 0) return;
  const P = s.polities[o];
  if (!alive(P, year) || !literate(g, P, year)) return;
  const era = ctx.eraAt(P.id, year);
  const d = g.doc(ctx.polityLang(P, year), year, `suit-debt:${e.id}`);
  const grain = grainGrams(g, seat, year);
  const partners = s.houses.filter((x) => x.id !== h.id && x.born <= year && (x.died ?? 9999) > year && h.partners.includes(x.settlement)).slice(0, 2);
  const creditors = [
    ...partners.map((x) => `${houseLabel(x.kind, d.n(`hou:${x.id}`))} of ${d.n(`set:${x.settlement}`)}`),
    ...[0, 1, 2].slice(0, 4 - partners.length).map((i) => commoner(g, d, ctx.polityCulture(P, year), year, `creditor:${e.id}:${i}`)),
  ];
  const claims = creditors.map(() => grain * r.int(40, 900));
  const total = claims.reduce((a, b) => a + b, 0);
  const share = r.int(8, 45);
  const causes = e.causes.filter((c) => s.events[c].year <= year && g.T.pageRefs.has(`evt:${c}`));
  const lines: string[] = [courtHeader(g, d, P, seat, year, era), ''];
  lines.push(`In the matter of ${houseLabel(h.kind, d.n(`hou:${h.id}`))}, which has ${era >= 4 ? 'suspended payment' : 'failed and cannot pay'}${causes.length ? ` after the ${d.n(`evt:${causes[0]}`)}` : ''}. The creditors came before ${judgeName(g, d, P, year, era, `debt:${e.id}`)} and proved their claims:`);
  lines.push('');
  lines.push('| Creditor | Claim |', '|---|---|');
  creditors.forEach((c, i) => lines.push(`| ${c} | ${money(g, d, claims[i], P.id, year)} |`));
  lines.push(`| **Total** | **${money(g, d, total, P.id, year)}** |`);
  lines.push('');
  lines.push(`**Judgment.** The goods, ships and stores of the house shall be sold, and the creditors shall share what is found: ${share} in the hundred. ${r.pick(['The partners may not trade in the market for five years.', 'The house shall be struck from the roll of merchants.', 'What remains unpaid is forgiven by the court.'])}`);
  lines.push('', '---', '', `**Editorial note.** See the ${d.title(`evt:${e.id}`)}.`);
  const author = g.author(P, 'scribe', year);
  addDoc(g, { sub: 'lawsuit', year, title: `Creditors' suit against the ${g.T.short.get(`hou:${h.id}`)} (AY ${year})`, author: author.id, p: P, d, body: lines, settlement: seat, about: [e.id], m: med(era, 'soft', r) });
}

function inheritanceSuit(g: Gen, e: SimEvent, r: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const pr = e.parts.find(([, role]) => role === 'polity')?.[0];
  const pred = e.parts.find(([, role]) => role === 'predecessor')?.[0];
  const usurper = e.parts.find(([, role]) => role === 'successor')?.[0];
  if (!pr || !pred || !usurper) return;
  const P = s.polities[ctx.idNum(pr)];
  const year = Math.min(4999, e.year + r.int(0, 4));
  if (!alive(P, year) || !literate(g, P, year)) return;
  const old = s.persons[ctx.idNum(pred)];
  const heirs = old.children.map((c) => s.persons[c]).filter((c) => c.born + 14 <= year && c.died > year && g.T.pageRefs.has(`per:${c.id}`));
  if (!heirs.length) return;
  const heir = heirs[0];
  const era = ctx.eraAt(P.id, year);
  const d = g.doc(ctx.polityLang(P, year), year, `suit-heir:${e.id}`);
  const seat = capitalAlive(g, P, year);
  const u = s.persons[ctx.idNum(usurper)];
  const judge = u.died >= year && u.born + 16 <= year ? `${u.sex === 'f' ? 'the queen' : 'the king'} ${d.n(usurper)}` : judgeName(g, d, P, year, era, `heir:${e.id}`);
  const pension = grainGrams(g, seat, year) * r.int(100, 600);
  const granted = r.chance(0.35);
  const lines: string[] = [courtHeader(g, d, P, seat, year, era), ''];
  lines.push(`${d.n(`per:${heir.id}`)}, ${heir.sex === 'f' ? 'daughter' : 'son'} of ${d.n(pred)}, came before ${judge} and asked for the estates of ${heir.sex === 'f' ? 'her' : 'his'} father: ${r.pick(['the palace gardens', 'the villages of the river plain', 'the herds and the hunting grounds', 'the house in the upper city'])} and the revenues of ${d.n(`set:${seat}`)}.`);
  lines.push('');
  lines.push(`It was answered for the crown that these were the property of the throne and not of ${d.n(pred)}, and that the throne had passed by the ${d.n(`evt:${e.id}`)}.`);
  lines.push('');
  lines.push(granted
    ? `**Judgment.** Out of mercy, ${d.n(`per:${heir.id}`)} shall receive ${money(g, d, pension, P.id, year)} a year, and shall live at ${d.n(`set:${seat}`)} under guard.`
    : `**Judgment.** The petition is refused. ${r.pick(['Let the petitioner be thankful for life.', 'The estates remain with the crown.', 'The petitioner shall leave the city within the month.'])}`);
  lines.push('', '---', '', `**Editorial note.** A legal sequel to the ${d.title(`evt:${e.id}`)}.`);
  const author = g.author(P, 'scribe', year);
  addDoc(g, { sub: 'lawsuit', year, title: `Petition of ${g.T.short.get(`per:${heir.id}`)} for the estates of ${g.T.short.get(pred)}`, author: author.id, p: P, d, body: lines, settlement: seat, about: [e.id], m: med(era, 'soft', r) });
}

// ---------------------------------------------------------------- 2. merchants' wills
function genWills(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const h of s.houses) {
    h.heads.forEach(([start, headId], i) => {
      const head = s.persons[headId];
      if (head.died >= 5000 || head.died < start + 1) return;
      const r = new Rng(s.seed).fork('will', h.id, i);
      if (!r.chance(0.16)) return;
      const year = Math.max(start + 1, head.died - r.int(0, 2), head.born + 18);
      if (year > head.died || year > 4999) return;
      const seat = s.settlements[h.settlement];
      if (seat.founded > year) return;
      const o = ctx.ownerAt(seat.cell, year);
      if (o < 0) return;
      const P = s.polities[o];
      if (!alive(P, year) || !literate(g, P, year)) return;
      will(g, h.id, i, P, year, r);
    });
  }
}

function will(g: Gen, hid: number, i: number, P: Polity, year: number, r: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const h = s.houses[hid];
  const head = s.persons[h.heads[i][1]];
  const era = ctx.eraAt(P.id, year);
  const d = g.doc(ctx.polityLang(P, year), year, `will:${hid}:${i}`);
  const next = h.heads[i + 1];
  const heir = next && s.persons[next[1]].born <= year ? s.persons[next[1]] : null;
  const goods = h.goods.filter((x) => year >= GOODS[x].from && year <= GOODS[x].to);
  const lines: string[] = [];
  lines.push(era <= 1
    ? `Thus says ${d.n(`per:${head.id}`)}, merchant of ${d.n(`set:${h.settlement}`)}, being sick but of sound mind:`
    : `I, ${d.n(`per:${head.id}`)}, head of ${houseLabel(h.kind, d.n(`hou:${h.id}`))} at ${d.n(`set:${h.settlement}`)}, ${r.pick(['being of sound mind though weak in body', 'knowing that no one escapes death', 'mindful of the uncertainty of life'])}, make this my ${era >= 4 ? 'last will and testament' : 'testament'}.`);
  lines.push('');
  let n = 0;
  if (heir) lines.push(`${++n}. To ${d.n(`per:${heir.id}`)} I leave the house, its books, its ${era <= 2 ? 'seals' : 'credit'} and its debts${heir.father === head.id ? `, as to my ${heir.sex === 'f' ? 'daughter' : 'son'}` : ''}.`);
  for (const gd of r.sample(goods, Math.min(2, goods.length))) {
    const [lo, hi] = QTY[GOODS[gd].key] ?? [5, 50];
    const qty = r.int(lo, hi);
    const pr = g.price(h.settlement, gd, year);
    if (pr === null) continue;
    lines.push(`${++n}. To ${commoner(g, d, head.culture, year, `legatee:${hid}:${i}:${gd}`)}, ${r.pick(['my partner', 'my faithful agent', 'my sister’s son', 'my old clerk'])}, ${units(qty, gd)} of ${goodName(gd)} from the warehouse, worth ${money(g, d, pr * qty, P.id, year)}.`);
  }
  const rel = ctx.religionOf(P.id, year);
  const m = rel >= 0 && s.movements[rel].born <= year ? s.movements[rel] : null;
  const god = m && m.deities.length ? m.deities[r.int(0, m.deities.length - 1)] : null;
  const gift = grainGrams(g, h.settlement, year) * r.int(20, 200);
  if (m) lines.push(`${++n}. To the ${god !== null ? `temple of ${d.n(`dei:${god}`)}` : `house of the ${d.n(`mov:${m.id}`)}`}, ${money(g, d, gift, P.id, year)}, ${r.pick(['for lamps to burn for my soul', 'that the priests may pray for me', 'for the feeding of the poor on the feast day'])}.`);
  lines.push(`${++n}. ${r.pick(['My servants are set free on the day of my death.', 'Let my debts be paid before any legacy.', 'Let no one contest this testament, on pain of losing their share.'])}`);
  lines.push('');
  lines.push(`${era <= 1 ? 'Sealed' : 'Signed and sealed'} ${localDate(ctx, d, P, year)}, before the witnesses ${[...new Set([0, 1, 2, 3].map((k) => commoner(g, d, head.culture, year, `willwit:${hid}:${i}:${k}`)))].slice(0, 2).join(' and ')}.`);
  lines.push('', '---', '', `**Editorial note.** ${d.ed(`per:${head.id}`)} died in AY ${head.died}. The values are reckoned at the prices of ${d.ed(`set:${h.settlement}`)} in that decade; see the ${d.title(`hou:${h.id}`)}.`);
  addDoc(g, { sub: 'will', year, title: `Testament of ${g.T.short.get(`per:${head.id}`)}, merchant of ${g.T.short.get(`set:${h.settlement}`)}`, author: head.id, p: P, d, body: lines, settlement: h.settlement, about: [], m: med(era, 'soft', r) });
}

// ---------------------------------------------------------------- 3. muster rolls
const ARMS: string[][] = [
  ['spearmen', 'archers', 'chariot crews', 'slingers'],
  ['spearmen', 'archers', 'horsemen', 'shield-bearers'],
  ['heavy infantry', 'light infantry', 'cavalry', 'archers'],
  ['men-at-arms', 'archers', 'mounted knights', 'levies'],
  ['pikemen', 'musketeers', 'gunners', 'dragoons'],
];

function genMusterRolls(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const e of s.events) {
    if (e.sub !== 'battle') continue;
    const size = Number(e.data.attackerSize) + Number(e.data.defenderSize);
    const r = new Rng(s.seed).fork('muster', e.id);
    if (!r.chance(Math.min(0.35, size / 250_000))) continue;
    const side = r.chance(0.5) ? 'attacker' : 'defender';
    const pr = e.parts.find(([, role]) => role === side)?.[0];
    if (!pr) continue;
    const P = s.polities[ctx.idNum(pr)];
    const year = e.year;
    const era = ctx.eraAt(P.id, year);
    if (era > 4 || !alive(P, year) || !literate(g, P, year)) continue;
    muster(g, e, P, side, r);
  }
}

function muster(g: Gen, e: SimEvent, P: Polity, side: 'attacker' | 'defender', r: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const year = e.year;
  const era = ctx.eraAt(P.id, year);
  const total = Math.round(Number(e.data[side === 'attacker' ? 'attackerSize' : 'defenderSize']));
  if (total < 200) return;
  const towns = s.settlements
    .filter((t) => t.founded <= year && (t.abandoned ?? 9999) > year && ctx.ownerAt(t.cell, year) === P.id)
    .map((t) => [t, t.popHistory.filter(([y]) => y <= year).pop()?.[1] ?? t.pop] as const)
    .sort((a, b) => b[1] - a[1] || a[0].id - b[0].id)
    .slice(0, 8);
  if (towns.length < 2) return;
  const sum = towns.reduce((a, [, p]) => a + p, 0);
  const counts = towns.map(([, p]) => Math.floor((total * p) / sum));
  counts[0] += total - counts.reduce((a, b) => a + b, 0);
  const d = g.doc(ctx.polityLang(P, year), year, `muster:${e.id}`);
  const cmd = e.parts.find(([, role]) => role === (side === 'attacker' ? 'attacking commander' : 'defending commander'))?.[0];
  const arms = ARMS[Math.min(era, ARMS.length - 1)];
  const lines: string[] = [];
  lines.push(`${era <= 1 ? 'Tablet of the levy' : 'Roll of the muster'} of ${d.n(`pol:${P.id}`)}, ${localDate(ctx, d, P, year)}${cmd ? `, under the command of ${d.n(cmd)}` : ''}.`);
  lines.push('');
  lines.push('| Town | Arm | Men |', '|---|---|---|');
  towns.forEach(([t], i) => lines.push(`| ${d.n(`set:${t.id}`)} | ${arms[(i + r.int(0, 3)) % arms.length]} | ${fmt(counts[i])} |`));
  lines.push(`| **Total** | | **${fmt(total)}** |`);
  lines.push('');
  lines.push(r.pick(['Each man to bring bread for ten days.', 'The captains of hundreds answer for the absent.', 'Deserters to be branded and returned to their towns.', 'The horses to be counted again at the river.']));
  lines.push('', '---', '', `**Editorial note.** Drawn up for the ${d.title(`evt:${e.id}`)}; the total equals the ${side}'s strength recorded for that battle. Contingents follow the size of each town.`);
  const author = g.author(P, 'scribe', year);
  addDoc(g, { sub: 'muster', year, title: `Muster roll of ${g.T.short.get(`pol:${P.id}`)} for the ${g.T.short.get(`evt:${e.id}`)}`, author: author.id, p: P, d, body: lines, settlement: null, cell: e.cell, about: [e.id], m: med(era, 'soft', r) });
}

// ---------------------------------------------------------------- 4. port registers
const SHIP_ADJ = ['Swift', 'Golden', 'Faithful', 'Bright', 'Patient', 'Lucky', 'Black', 'Silver', 'Morning', 'Laughing'];
const SHIP_NOUN = ['Dolphin', 'Gull', 'Star', 'Heron', 'Promise', 'Wind', 'Maiden', 'Ram', 'Lantern', 'Pilgrim'];

function genManifests(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const rt of s.routes) {
    const r = new Rng(s.seed).fork('manifest', rt.year);
    const sea = rt.edges.filter(([a, b]) => s.settlements[a].port && s.settlements[b].port);
    for (const [a, b] of r.sample(sea, Math.min(sea.length, 14))) {
      if (!r.chance(0.75)) continue;
      const year = Math.min(4999, rt.year + r.int(0, 99));
      const [from, to] = r.chance(0.5) ? [a, b] : [b, a];
      manifest(g, from, to, year, r.fork(from, to));
    }
  }
}

function manifest(g: Gen, from: number, to: number, year: number, r: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const A = s.settlements[from], B = s.settlements[to];
  if (A.founded > year || B.founded > year || (A.abandoned ?? 9999) <= year || (B.abandoned ?? 9999) <= year) return;
  const ob = ctx.ownerAt(B.cell, year);
  if (ob < 0) return;
  const P = s.polities[ob];
  const era = ctx.eraAt(P.id, year);
  if (era < 1 || !alive(P, year) || !literate(g, P, year)) return;
  const oa = ctx.ownerAt(A.cell, year);
  const goods = GOODS.filter((x) => year >= x.from && year <= x.to && g.price(from, x.id, year) !== null);
  if (goods.length < 2) return;
  const d = g.doc(ctx.polityLang(P, year), year, `manifest:${from}:${to}:${year}`);
  const ship = `the ${r.pick(SHIP_ADJ)} ${r.pick(SHIP_NOUN)}`;
  const captain = commoner(g, d, oa >= 0 ? ctx.polityCulture(oa, year) : A.culture, year, `captain:${from}:${year}`);
  const lines: string[] = [];
  lines.push(`${era >= 5 ? 'Harbour register' : 'Register of the harbour'} of ${d.n(`set:${to}`)}, ${localDate(ctx, d, P, year)}. Entered: ${ship}${era >= 5 ? ' (steamer)' : ''}, master ${captain}, out of ${d.n(`set:${from}`)}${oa >= 0 && oa !== P.id ? ` in ${d.n(`pol:${oa}`)}` : ''}.`);
  lines.push('');
  lines.push('| Cargo | Quantity | Value | Toll |', '|---|---|---|---|');
  let total = 0, tolls = 0;
  const rate = r.int(2, 10) / 100;
  for (const gd of r.sample(goods, Math.min(goods.length, r.int(3, 5)))) {
    const [lo, hi] = QTY[gd.key] ?? [5, 50];
    const qty = r.int(lo, hi);
    const value = (g.price(from, gd.id, year) ?? gd.base) * qty;
    total += value;
    tolls += value * rate;
    lines.push(`| ${goodName(gd.id)} | ${units(qty, gd.id)} | ${money(g, d, value, P.id, year)} | ${money(g, d, value * rate, P.id, year)} |`);
  }
  lines.push(`| **Total** | | **${money(g, d, total, P.id, year)}** | **${money(g, d, tolls, P.id, year)}** |`);
  lines.push('');
  lines.push(`Toll taken at ${Math.round(rate * 100)} in the hundred. ${r.pick(['Seals checked and found whole.', 'Two jars broken in the hold; not charged.', 'The master swears the cargo is his own.', 'Passengers: none.', 'Released to the quay at noon.'])}`);
  lines.push('', '---', '', `**Editorial note.** Values are reckoned at the market prices of ${d.ed(`set:${from}`)} in that decade; the route between the two ports appears on the atlas for the century.`);
  const author = g.author(P, 'scribe', year);
  addDoc(g, { sub: 'manifest', year, title: `Port register of ${g.T.short.get(`set:${to}`)}: ${ship} from ${g.T.short.get(`set:${from}`)} (AY ${year})`, author: author.id, p: P, d, body: lines, settlement: to, about: [], m: med(era, 'soft', r) });
}

// ---------------------------------------------------------------- 5. loanword glossaries
const GLOSS_CONCEPTS = ['water', 'fire', 'king', 'god', 'city', 'mother', 'father', 'bread', 'horse', 'silver', 'salt', 'wine', 'river', 'road', 'market', 'war', 'peace', 'house', 'sun', 'moon', 'ship', 'grain', 'sheep', 'sword', 'gold', 'friend', 'enemy', 'law'];

function genGlossaries(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const w = s.world;
  const r = new Rng(s.seed).fork('glossaries');
  for (let Y = 300; Y < 5000; Y += 250) {
    const pairs = new Map<string, { a: number; b: number; cell: number; n: number }>();
    for (let c = 0; c < w.n; c++) {
      if (!w.land[c]) continue;
      const ca = ctx.cultureAt(c, Y);
      if (ca < 0) continue;
      for (const k of w.neighbors[c]) {
        const cb = ctx.cultureAt(k, Y);
        if (cb < 0 || cb === ca) continue;
        const key = `${ca}:${cb}`;
        const v = pairs.get(key);
        if (v) v.n++;
        else pairs.set(key, { a: ca, b: cb, cell: k, n: 1 });
      }
    }
    for (const v of [...pairs.values()].sort((x, y) => y.n - x.n || x.a - y.a || x.b - y.b).slice(0, 24)) {
      if (!r.chance(0.5)) continue;
      glossary(g, v.a, v.b, v.cell, Y + r.int(0, 200), r.fork(v.a, v.b, Y));
    }
  }
}

function glossary(g: Gen, A: number, B: number, borderCell: number, year: number, r: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  if (year > 4999) return;
  const la = s.cultures[A].lang, lb = s.cultures[B].lang;
  if (la === lb) return;
  const ia = s.lang.info(la), ib = s.lang.info(lb);
  if (ia.born > year || ib.born > year || (ia.died !== null && ia.died <= year) || (ib.died !== null && ib.died <= year)) return;
  // a literate court of the first people keeps the list
  const P = s.polities.filter((p) => alive(p, year) && ctx.polityCulture(p, year) === A && literate(g, p, year))
    .sort((x, y) => ((ctx.statsAt(y.id, year)?.[2] as number) ?? 0) - ((ctx.statsAt(x.id, year)?.[2] as number) ?? 0) || x.id - y.id)[0];
  if (!P) return;
  const d = g.doc(la, year, `gloss:${A}:${B}:${year}`);
  const concepts = r.sample(GLOSS_CONCEPTS, r.int(10, 15));
  const lines: string[] = [];
  lines.push(`*Words of the ${d.n(`cul:${B}`)}, with their meanings in our tongue, for the scribes of ${d.n(`pol:${P.id}`)}. ${cap(localDate(ctx, d, P, year))}.*`);
  lines.push('');
  lines.push(`| Meaning | ${d.n(`lan:${la}`)} | ${d.n(`lan:${lb}`)} |`, '|---|---|---|');
  for (const c of concepts) {
    const wa = s.lang.word(la, c, year), wb = s.lang.word(lb, c, year);
    lines.push(`| ${c} | ${wa.conventional} *(${wa.scholarly})* | ${wb.conventional} *(${wb.scholarly})* |`);
  }
  // place names across the border, as each people says them
  const towns = s.settlements.filter((t) => t.founded <= year && (t.abandoned ?? 9999) > year && ctx.cultureAt(t.cell, year) === B)
    .sort((x, y) => Math.hypot(s.world.x[x.cell] - s.world.x[borderCell], s.world.y[x.cell] - s.world.y[borderCell]) - Math.hypot(s.world.x[y.cell] - s.world.x[borderCell], s.world.y[y.cell] - s.world.y[borderCell]) || x.id - y.id)
    .slice(0, 3);
  if (towns.length) {
    lines.push('');
    lines.push('**Places across the border:**');
    lines.push('');
    for (const t of towns) {
      let nm = t.names[0][1];
      for (const [y, v] of t.names) if (y <= year) nm = v;
      lines.push(`- ${d.link(`set:${t.id}`, s.lang.realize(nm, la, year).conventional)}, which they call *${s.lang.realize(nm, lb, year).conventional}*.`);
    }
  }
  lines.push('');
  lines.push(`*${r.pick(['Copied by', 'Written out by', 'Collected by'])} ${d.n(`per:${g.author(P, 'scribe', year).id}`)}.*`);
  lines.push('', '---', '', `**Editorial note.** A bilingual word list from the frontier between the ${d.ed(`cul:${A}`)} and the ${d.ed(`cul:${B}`)}. The forms are those of AY ${year}; compare the sound changes listed on the pages of the two languages.`);
  const author = g.author(P, 'scribe', year);
  addDoc(g, { sub: 'glossary', year, title: `Word list of ${g.T.short.get(`lan:${lb}`)} for scribes of ${g.T.short.get(`pol:${P.id}`)} (AY ${year})`, author: author.id, p: P, d, body: lines, settlement: null, about: [], m: med(ctx.eraAt(P.id, year), 'clay', r) });
}

// ---------------------------------------------------------------- 6. school exercises
function genExercises(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const p of s.polities) {
    const end = Math.min((p.died ?? 5000) - 1, 4999);
    for (let y = p.born + 30; y <= end; y += 90) {
      const r = new Rng(s.seed).fork('exercise', p.id, y);
      if (!r.chance(0.35)) continue;
      const year = Math.min(end, y + r.int(0, 60));
      if (!literate(g, p, year) || ctx.eraAt(p.id, year) > 4) continue;
      exercise(g, p, year, r);
    }
  }
}

function misspell(name: string, r: Rng): string {
  if (name.length < 4) return name + name[name.length - 1];
  const i = r.int(1, name.length - 3);
  return name.slice(0, i) + name[i + 1] + name[i] + name.slice(i + 2);
}

function exercise(g: Gen, P: Polity, year: number, r: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const era = ctx.eraAt(P.id, year);
  const d = g.doc(ctx.polityLang(P, year), year, `exercise:${P.id}:${year}`);
  const reigns = (ctx.reigns.get(P.id) ?? []).filter((x) => x.role === 'ruler' && x.start <= year).slice(-8);
  const student = commoner(g, d, ctx.polityCulture(P, year), year, `student:${P.id}:${year}`);
  const lines: string[] = [];
  let kind: string;
  if (reigns.length >= 3 && r.chance(0.6)) {
    kind = 'king list';
    lines.push(`*The kings of ${d.n(`pol:${P.id}`)}, as copied by the pupil ${student}:*`);
    lines.push('');
    const wrong = r.int(0, reigns.length - 1);
    reigns.forEach((x, i) => {
      const nm = d.nameOf(`per:${x.person}`);
      const current = x.end >= year;
      const yrs = Math.max(1, x.end - x.start);
      const shownName = i === wrong ? `~~${misspell(nm, r)}~~ ${d.link(`per:${x.person}`, nm)}` : d.link(`per:${x.person}`, nm);
      const shownYears = i === (wrong + 2) % reigns.length && !current ? `~~${yrs + r.int(1, 9)}~~ ${yrs}` : String(yrs);
      lines.push(`${i + 1}. ${shownName}${current ? ` — ${r.pick(['may he live for ever', 'who reigns now', 'whom the gods keep'])}` : `, reigned ${shownYears} years`}`);
    });
  } else {
    kind = 'model letter';
    const r0 = ctx.rulerAt(P.id, year);
    lines.push(`*A model letter, copied by the pupil ${student}:*`);
    lines.push('');
    const lord = r0 ? d.n(`per:${r0.person}`) : 'my lord';
    lines.push(`> To ${lord}, my lord, say: thus says your servant. ${r.pick(['May the gods keep my lord.', 'All is well with the house of my lord.', 'The grain of my lord is safe in the granary.'])} ${r.pick(['I have sent the tablets as my lord commanded.', 'The ~~sheeps~~ sheep of my lord are counted.', 'The boat of my lord has arrived at the quay.'])}`);
  }
  lines.push('');
  lines.push(`*Teacher's note:* ${r.pick(['Write it again, ten times.', 'Your signs are crooked; the copy is good.', 'Careless! The names of the kings are sacred.', 'Better than yesterday.', 'You will be beaten if this happens again.'])}`);
  lines.push('', '---', '', `**Editorial note.** A scribal school exercise (${kind}) from ${d.ed(`set:${capitalAlive(g, P, year)}`)}. Struck-through words are the pupil's errors; the teacher's corrections follow them.`);
  addDoc(g, { sub: 'exercise', year, title: `School exercise from ${g.T.short.get(`set:${capitalAlive(g, P, year)}`)}: ${kind} (AY ${year})`, author: null, p: P, d, body: lines, settlement: capitalAlive(g, P, year), about: [], m: med(era, 'clay', r) });
}

// ---------------------------------------------------------------- 7. almanacs
const FEAST_MONTH: Record<string, number> = { sky: 5, sun: 5, moon: 0, earth: 1, war: 2, river: 3, sea: 3, storm: 8, grain: 7, underworld: 10, wisdom: 9, fire: 11 };

function genAlmanacs(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const p of s.polities) {
    const end = Math.min((p.died ?? 5000) - 1, 4999);
    for (let c = Math.floor(p.born / 100); c * 100 <= end; c++) {
      const r = new Rng(s.seed).fork('almanac', p.id, c);
      if (!r.chance(0.35)) continue;
      const year = Math.max(p.born, Math.min(end, c * 100 + r.int(0, 99)));
      if (ctx.eraAt(p.id, year) < 2 || !literate(g, p, year)) continue;
      almanac(g, p, year, r);
    }
  }
}

function almanac(g: Gen, P: Polity, year: number, r: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const era = ctx.eraAt(P.id, year);
  const d = g.doc(ctx.polityLang(P, year), year, `almanac:${P.id}:${year}`);
  const seat = capitalAlive(g, P, year);
  const cell = s.settlements[seat].cell;
  const lat = Math.abs(s.world.lat[cell]);
  const precip = s.world.precip[cell];
  const river = s.world.flux[cell] > s.world.riverThreshold;
  const cu = ctx.polityCulture(P, year);
  const seenMonth = new Map<string, number>();
  const ms = months(ctx, cu).map((n) => {
    const nm = ctx.name(n, d.lang, year);
    const k = (seenMonth.get(nm) ?? 0) + 1;
    seenMonth.set(nm, k);
    return d.link(`cul:${cu}`, k > 1 ? `${nm} II` : nm);
  });
  const rel = ctx.religionOf(P.id, year);
  const m = rel >= 0 && s.movements[rel].born <= year ? s.movements[rel] : s.movements[s.cultures[cu].pantheon];
  const feasts = new Map<number, string[]>();
  const addFeast = (mi: number, text: string) => {
    if (!feasts.has(mi)) feasts.set(mi, []);
    feasts.get(mi)!.push(text);
  };
  for (const did of m.deities) addFeast(FEAST_MONTH[s.deities[did].domain] ?? r.int(0, 11), `feast of ${d.n(`dei:${did}`)}`);
  if (!m.deities.length) {
    // a founded faith keeps the memory of its founding and its founder
    addFeast(((m.born % 12) + 12) % 12, `feast of the founding of the ${d.n(`mov:${m.id}`)}`);
    if (m.founder !== null && s.persons[m.founder].born <= year) addFeast(((m.born + 5) % 12 + 12) % 12, `day of ${d.n(`per:${m.founder}`)}`);
    addFeast(2, 'the Great Fast');
    addFeast(11, 'festival of lights');
  }
  // the farming year of this place
  const notes: string[] = new Array(12).fill('');
  if (lat < 22) {
    notes[4] = 'The rains begin; plant the low fields.'; notes[8] = 'The rains end; harvest the millet.'; notes[11] = 'Dry season: mend the dykes.';
  } else if (river && precip < 500) {
    notes[6] = 'The river rises; open the canals.'; notes[9] = 'The flood falls; sow the barley.'; notes[2] = 'Harvest the barley; pay the tithe.';
  } else {
    notes[2] = 'Plough and sow the spring grain.'; notes[5] = 'Shear the sheep.'; notes[7] = 'Harvest; bring in the sheaves.'; notes[9] = 'Press the grapes; sow the winter wheat.'; notes[11] = 'Slaughter the swine; salt the meat.';
  }
  const drought = s.anomalies.find((a) => (a.kind === 'drought' || a.kind === 'cold') && a.start <= year && a.end >= year && (a.cells.length === 0 || a.cells.includes(cell)));
  const lines: string[] = [];
  const yearOnly = localDate(ctx, d, P, year).replace(/^in /, '').replace(/ \[AY \d+\]$/, '').replace(/^\d+ \[\[[^\]]+\]\] /, 'the year ').replace(/^the year the year /, 'the year ');
  lines.push(`*${era >= 4 ? 'Almanac' : 'Calendar of the feasts and works'} of ${d.n(`pol:${P.id}`)} for ${yearOnly}, ${era >= 4 ? 'printed' : 'set out'} by the ${era >= 4 ? 'almanac-makers' : 'priests'} of ${d.n(`set:${seat}`)}.*`);
  lines.push('');
  lines.push('| Month | Feasts | Works of the field |', '|---|---|---|');
  for (let i = 0; i < 12; i++) lines.push(`| ${ms[i]} | ${(feasts.get(i) ?? []).join('; ') || '—'} | ${notes[i] || '—'} |`);
  lines.push('');
  if (drought) lines.push(`**Warning.** ${drought.kind === 'drought' ? 'The rains have failed these years. Sow the low fields first, keep back seed-corn, and trust no promise of rain.' : 'The winters are long these years. Sow late and keep the herds near the stalls.'}`);
  else lines.push(r.pick(['Lucky days: the third and the ninth of each month.', 'Do not begin a journey at the new moon.', 'Marriages are best made after the harvest.', 'On feast days the markets are closed.']));
  lines.push('', '---', '', `**Editorial note.** Feasts follow the gods of the ${d.title(`mov:${m.id}`)}; the farming notes suit the climate of ${d.ed(`set:${seat}`)}.${drought ? ` The warning reflects the ${d.title(`cli:${drought.id}`)}.` : ''}`);
  const author = g.author(P, era >= 4 ? 'scribe' : 'priest', year);
  addDoc(g, { sub: 'almanac', year, title: `Almanac of ${g.T.short.get(`pol:${P.id}`)} for AY ${year}`, author: author.id, p: P, d, body: lines, settlement: seat, about: drought ? [drought.event] : [], m: med(era, 'print', r) });
}

// ---------------------------------------------------------------- 8. graffiti
function genGraffiti(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const e of s.events) {
    if (e.sub !== 'sack') continue;
    const r = new Rng(s.seed).fork('graffito', e.id);
    if (!r.chance(0.22)) continue;
    const br = e.parts.find(([, role]) => role === 'besieger')?.[0];
    const tr = e.parts.find(([, role]) => role === 'settlement')?.[0];
    if (!br || !tr) continue;
    const B = s.polities[ctx.idNum(br)];
    if (!alive(B, e.year) || !literate(g, B, e.year)) continue;
    soldierGraffito(g, e, B, ctx.idNum(tr), r);
  }
  // everyday graffiti in great cities
  for (const t of s.settlements) {
    for (const [y, pop] of t.popHistory) {
      if (pop < 60000) continue;
      const r = new Rng(s.seed).fork('graffito-city', t.id, y);
      if (!r.chance(0.14)) continue;
      const year = Math.min(4999, y + r.int(0, 99));
      if ((t.abandoned ?? 9999) <= year) continue;
      const o = ctx.ownerAt(t.cell, year);
      if (o < 0) continue;
      const P = s.polities[o];
      if (!alive(P, year) || !literate(g, P, year)) continue;
      cityGraffito(g, t.id, P, year, r);
    }
  }
}

function soldierGraffito(g: Gen, e: SimEvent, B: Polity, town: number, r: Rng): void {
  const ctx = g.ctx;
  const year = e.year;
  const era = ctx.eraAt(B.id, year);
  const d = g.doc(ctx.polityLang(B, year), year, `graffito:${e.id}`);
  const cu = ctx.polityCulture(B, year);
  const soldier = commoner(g, d, cu, year, `soldier:${e.id}`);
  const father = commoner(g, d, cu, year - 25, `soldierf:${e.id}`);
  const surface = r.pick(['scratched on the base of a statue', 'cut into the plaster of a temple wall', 'scratched on a column of the gate', 'painted on the wall of a house']);
  const text = r.pick([
    `${soldier}, son of ${father}, of ${d.n(`pol:${B.id}`)}, was here when ${d.n(`set:${town}`)} fell.`,
    `${soldier} took the wine of this house. ${r.pick(['It was sour.', 'It was good.', 'There was not enough.'])}`,
    `I, ${soldier}, ${era >= 4 ? 'of the regiment of' : 'of the army of'} ${d.n(`pol:${B.id}`)}, wish I were home.`,
    `${soldier} and ${commoner(g, d, cu, year, `comrade:${e.id}`)}: we came, we took, we go home rich.`,
    `Gods of ${d.n(`set:${town}`)}, forgive ${soldier}.`,
  ]);
  const lines = [`*Graffito ${surface} at ${d.n(`set:${town}`)}:*`, '', `> ${text}`, '', '---', '', `**Editorial note.** Left by a soldier of ${d.ed(`pol:${B.id}`)} during the ${d.title(`evt:${e.id}`)}.`];
  addDoc(g, { sub: 'graffito', year, title: `Soldier's graffito at ${g.T.short.get(`set:${town}`)} (AY ${year})`, author: null, p: B, d, body: lines, settlement: town, about: [e.id], m: { medium: `graffito, ${surface.split(' ').slice(-2).join(' ')}`, durable: 0.6, tau: 3000 } });
}

function cityGraffito(g: Gen, town: number, P: Polity, year: number, r: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const era = ctx.eraAt(P.id, year);
  const d = g.doc(ctx.polityLang(P, year), year, `graffito-city:${town}:${year}`);
  const cu = ctx.polityCulture(P, year);
  const a = commoner(g, d, cu, year, `ga:${town}:${year}`);
  const b = commoner(g, d, cu, year, `gb:${town}:${year}`, true);
  const head = ctx.rulerAt(P.id, year);
  const options = [
    `${a} loves ${b}.`,
    `${a} owes me three ${era >= 2 ? 'coins' : 'measures of barley'}. Pay up, ${a}!`,
    `The wine at the sign of the ${r.pick(['Ram', 'Lamp', 'Two Fish', 'Bull'])} is water.`,
    `Here ${a} slept, and dreamed of ${b}.`,
    `${a} is a thief. Everybody knows it.`,
  ];
  if (era >= 4 && head && ['republic', 'democracy', 'federation', 'constitutional-monarchy'].includes(ctx.govAt(P, year)) && s.persons[head.person].born <= year) options.push(`Down with ${d.n(`per:${head.person}`)}!`);
  const text = r.pick(options);
  const lines = [`*Graffito on a wall at ${d.n(`set:${town}`)}:*`, '', `> ${text}`, '', '---', '', `**Editorial note.** One of the many scribbles of ordinary people on the walls of ${d.ed(`set:${town}`)}; such texts survive in their thousands and are rarely dated, but this one is placed by its context around AY ${year}.`];
  addDoc(g, { sub: 'graffito', year, title: `Graffito at ${g.T.short.get(`set:${town}`)} (c. AY ${year})`, author: null, p: P, d, body: lines, settlement: town, about: [], m: { medium: 'graffito on plaster', durable: 0.45, tau: 2500 } });
  void ordinal;
  void domainPhrase;
}
