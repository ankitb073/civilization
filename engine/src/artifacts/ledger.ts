// Merchant ledgers and letters: day-books of trading houses with entries priced from the simulated
// market series in the currency that circulated, and margin notes citing wars, famines, debasements.
import type { Gen } from './gen.ts';
import { fmt, goodName, goodUnit } from './gen.ts';
import { localDate, months } from '../archive/doc.ts';
import type { Doc } from '../archive/doc.ts';
import type { House, Polity } from '../sim/state.ts';
import { GOODS } from '../sim/economy.ts';
import { TK } from '../sim/tech.ts';
import { Rng } from '../core/rng.ts';
import { ordinal } from '../archive/context.ts';

export function genLedgers(g: Gen): void {
  const s = g.ctx.s;
  for (const h of s.houses) {
    const end = Math.min(h.died ?? 5000, 4999);
    if (end - h.born < 3) continue;
    const rng = new Rng(s.seed).fork('ledger', h.id);
    const count = Math.min(3, 1 + Math.floor((end - h.born) / 70));
    const years = new Set<number>();
    for (let i = 0; i < count; i++) years.add(rng.int(h.born + 1, end));
    for (const y of [...years].sort((a, b) => a - b)) ledger(g, h, y, rng.fork(y));
    if (rng.chance(0.35)) letter(g, h, rng.int(h.born + 1, end), rng.fork('letter'));
  }
}

function seatPolity(g: Gen, h: House, year: number): Polity | null {
  const o = g.ctx.ownerAt(g.ctx.s.settlements[h.settlement].cell, year);
  return o >= 0 ? g.ctx.s.polities[o] : null;
}

function headAt(h: House, year: number): number {
  let head = h.heads[0][1];
  for (const [y, p] of h.heads) if (y <= year) head = p;
  return head;
}

const QTY: Record<string, [number, number]> = {
  grain: [20, 400], salt: [5, 80], copper: [10, 200], tin: [2, 40], bronze: [10, 120], iron: [10, 300], cloth: [5, 120],
  timber: [10, 200], horses: [1, 12], spice: [1, 30], oil: [5, 120], gold: [1, 5], coal: [20, 2000], steel: [5, 300],
  petroleum: [50, 5000], machinery: [1, 20],
};

function ledger(g: Gen, h: House, year: number, rng: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const P = seatPolity(g, h, year);
  if (!P || ctx.scriptOf(P, year) < 0) return;
  const lang = ctx.polityLang(P, year);
  const d = g.doc(lang, year, `ledger:${h.id}:${year}`);
  const head = headAt(h, year);
  if (s.persons[head].died < year || s.persons[head].born + 16 > year) return;
  const t = s.settlements[h.settlement];
  const cur = ctx.currencyAt(P.id, year);
  const curOk = cur >= 0 && s.currencies[cur].born <= year;
  const grams = curOk ? ctx.contentAt(cur, year) : 8.3;
  const unitName = curOk ? d.nameOf(`cur:${cur}`) : 'shekels of silver';
  const unitLink = curOk ? d.link(`cur:${cur}`, unitName) : unitName;
  // partners alive in that year
  const partners = [...new Set(s.routes.filter((r) => r.year <= year && r.year > year - 100).flatMap((r) => r.edges.filter(([a, b]) => a === h.settlement || b === h.settlement).map(([a, b]) => (a === h.settlement ? b : a))))]
    .filter((x) => s.settlements[x].founded <= year && (s.settlements[x].abandoned ?? 9999) > year);
  if (partners.length === 0) partners.push(h.settlement);
  const goods = h.goods.filter((x) => year >= GOODS[x].from && year <= GOODS[x].to);
  if (goods.length === 0) return;
  const era = ctx.eraAt(P.id, year);
  const ms = months(ctx, P.culture);
  const n = rng.int(8, 14);
  const dates: [number, number][] = [];
  for (let i = 0; i < n; i++) dates.push([rng.int(0, 11), rng.int(1, 29)]);
  dates.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  // opening balance: a few months' trading at this house's scale (filled in once the entries are known)
  let balance = 0;
  const rows: string[][] = [];
  const entries: { market: number; good: number; unit: number; grams: number }[] = [];

  for (const [mi, day] of dates) {
    const good = rng.pick(goods);
    const partner = rng.pick(partners);
    const buying = rng.chance(0.5);
    let market = buying ? h.settlement : partner;
    let pg = g.price(market, good, year);
    if (pg === null) { market = h.settlement; pg = g.price(market, good, year); }
    if (pg === null) continue;
    const unit = (pg / grams) * (1 + rng.normal(0, 0.04));
    const [lo, hi] = QTY[GOODS[good].key] ?? [1, 50];
    const qty = rng.int(lo, hi);
    const amount = unit * qty;
    entries.push({ market, good, unit: Math.round(unit * 1e6) / 1e6, grams });
    balance += buying ? -amount : amount;
    const pHouse = s.houses.find((x) => x.settlement === partner && x.id !== h.id && x.born <= year && (x.died ?? 9999) > year);
    const counter = pHouse ? d.link(`hou:${pHouse.id}`, d.nameOf(`hou:${pHouse.id}`)) : `agent at ${d.n(`set:${partner}`)}`;
    rows.push([
      `${day} ${ctx.name(ms[mi], lang, year)}`,
      `${buying ? 'Bought of' : 'Sold to'} ${counter}${pHouse ? ` (${d.n(`set:${partner}`)})` : ''}`,
      `${goodName(good)}`,
      `${fmt(qty)} ${goodUnit(good)}${qty === 1 ? '' : 's'}`,
      fmtPrice(unit),
      `${buying ? '−' : '+'}${fmtPrice(amount)}`,
      String(balance),
    ]);
  }
  if (rows.length < 4) return;
  // rebase the running balance on an opening balance proportional to the year's turnover
  const turnover = entries.reduce((a, e) => a + 0, 0) + rows.reduce((a, r) => a + Math.abs(Number(r[5].replace(/[−+,]/g, ''))), 0);
  const openingBal = Math.round((turnover * (2 + rng.next() * 4)) / 10) * 10;
  for (const r of rows) r[6] = fmtPrice(openingBal + Number(r[6]));
  // margin notes from the year's events
  const notes: string[] = [];
  const near = (ref: string) => (ctx.eventsByRef.get(ref) ?? []).map((i) => s.events[i]).filter((e) => e.year <= year && e.year >= year - 3);
  for (const e of near(`pol:${P.id}`)) {
    if (notes.length >= 3) break;
    if (e.sub === 'war') notes.push(`${d.pick(['The roads are unsafe because of', 'Caravans are held back on account of', 'Insurance on goods doubled for'])} ${d.n(`evt:${e.id}`)}.`);
    else if (e.sub === 'debasement') notes.push(`${d.pick(['The new coin is light;', 'Since the reminting'])} sellers ${d.pick(['will not take it at par', 'demand more of it'])} (${d.n(`evt:${e.id}`)}).`);
    else if (e.sub === 'famine') notes.push(`Grain is dear: ${d.n(`evt:${e.id}`)}.`);
    else if (e.sub === 'plague') notes.push(`No ships to the stricken ports: ${d.n(`evt:${e.id}`)}.`);
    else if (e.sub === 'sack' || e.sub === 'conquest') notes.push(`Losses written off after ${d.n(`evt:${e.id}`)}.`);
    else if (e.sub === 'panic' || e.sub === 'default') notes.push(`Credit refused everywhere since ${d.n(`evt:${e.id}`)}.`);
  }
  const author = s.persons[head];
  const lines: string[] = [];
  lines.push(`${era <= 1 ? 'Accounts' : era <= 3 ? 'Day-book' : 'Journal'} of ${houseLabel(h.kind, d.n(`hou:${h.id}`))}, kept at ${d.n(`set:${t.id}`)} by ${d.n(`per:${head}`)}, ${localDate(ctx, d, P, year)}. Sums in ${unitLink}${curOk ? '' : ''}. Opening balance ${fmtPrice(openingBal)}.`);
  if (notes.length) {
    lines.push('');
    lines.push('Notes in the margin:');
    lines.push('');
    for (const nt of notes) lines.push(`- ${nt}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  const grain = GOODS.findIndex((x) => x.key === 'grain');
  const pNow = g.price(h.settlement, grain, year);
  const pThen = g.price(h.settlement, grain, year - 50);
  const trend = pNow !== null && pThen !== null ? `Grain at ${d.n(`set:${t.id}`)} cost ${fmt(pNow)} g of silver the measure (${fmtPrice(pNow / grams)} in the house's money), against ${fmt(pThen)} g fifty years earlier${pNow > pThen * 1.4 ? ', a steep rise' : pNow < pThen * 0.7 ? ', a marked fall' : ''}.` : '';
  lines.push(`**Editorial note.** Prices are in ${unitLink}${curOk ? `, then worth ${fmt(grams)} g of silver each` : ''}. ${trend} The house is described at ${d.title(`hou:${h.id}`)}.`.replace(/\s+/g, ' ').trim());
  g.add({
    sub: 'ledger', year, title: `${era <= 3 ? 'Day-book' : 'Ledger'} of the ${g.T.short.get(`hou:${h.id}`)}, AY ${year}`, author: author.id, polity: P.id,
    lang, script: ctx.scriptOf(P, year), medium: era <= 1 ? 'clay tablets' : era === 2 ? 'papyrus rolls' : era === 3 ? (ctx.s.polities[P.id].techs.has(TK.paper) ? 'paper quires' : 'parchment quires') : 'bound ledger', cell: t.cell, settlement: t.id,
    about: [], body: lines.join('\n'), mentions: d.mentions, dateText: localDate(ctx, d, P, year), flagship: false,
    ledger: { columns: ['Date', 'Counterparty', 'Goods', 'Quantity', `Unit price`, 'Amount', 'Balance'], rows, notes },
    data: { entries },
    durable: era <= 1 ? 0.7 : era <= 3 ? 0.3 : 0.6, tau: era <= 1 ? 3500 : era <= 3 ? 1200 : 3000, seat: t.id,
  });
}

function letter(g: Gen, h: House, year: number, rng: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const P = seatPolity(g, h, year);
  if (!P || ctx.scriptOf(P, year) < 0) return;
  const lang = ctx.polityLang(P, year);
  const d: Doc = g.doc(lang, year, `mletter:${h.id}:${year}`);
  const head = headAt(h, year);
  if (s.persons[head].died < year || s.persons[head].born + 16 > year) return;
  const partnerSet = h.partners.length ? rng.pick(h.partners) : h.settlement;
  const t = s.settlements[partnerSet];
  if (t.founded > year) return;
  const era = ctx.eraAt(P.id, year);
  const goods = h.goods.filter((x) => year >= GOODS[x].from && year <= GOODS[x].to);
  if (!goods.length) return;
  const good = rng.pick(goods);
  const cur = ctx.currencyAt(P.id, year);
  const curOk = cur >= 0 && s.currencies[cur].born <= year;
  const grams = curOk ? ctx.contentAt(cur, year) : 8.3;
  const unit = curOk ? d.link(`cur:${cur}`, d.nameOf(`cur:${cur}`)) : 'shekels of silver';
  const pHere = g.price(h.settlement, good, year);
  const pThere = g.price(partnerSet, good, year);
  const agentName = ctx.name(s.lang.coinName(ctx.polityLang(P, year), year, 'person-m', `agent:${h.id}:${year}`), lang, year);
  const lines: string[] = [];
  if (era <= 1) {
    lines.push(`To ${agentName}, say: thus says ${d.n(`per:${head}`)}.`);
    lines.push('');
    lines.push(`${d.pick(['The tablet you sent has reached me.', 'Your servant arrived with the donkeys.', 'I have heard what you wrote.'])} ${pHere !== null ? `Here at ${d.n(`set:${h.settlement}`)} ${goodName(good)} ${pluralGood(good) ? 'sell' : 'sells'} for ${fmtPrice(pHere / grams)} ${unit} the ${goodUnit(good)}.` : ''} ${pThere !== null ? `If at ${d.n(`set:${partnerSet}`)} it is ${fmtPrice(pThere / grams)}, ${pThere > (pHere ?? 0) ? 'send me none; sell it there' : 'buy all you can and send it with the next caravan'}.` : ''}`);
    lines.push('');
    lines.push(`${d.pick(['Do not let the palace take the goods for the tax.', 'Seal the packets with my seal.', 'Do not trust the ferryman again.'])} ${d.pick(['Be quick!', 'Do not delay!', 'Write to me of the price.'])}`);
  } else {
    lines.push(`${d.n(`per:${head}`)}, at ${d.n(`set:${h.settlement}`)}, to ${agentName} at ${d.n(`set:${partnerSet}`)}, greeting.`);
    lines.push('');
    lines.push(`${pHere !== null ? `First, ${goodName(good)} ${pluralGood(good) ? 'are' : 'is'} quoted here at ${fmtPrice(pHere / grams)} ${unit} the ${goodUnit(good)}. ` : ''}${pThere !== null ? `Your last said ${fmtPrice(pThere / grams)} with you. ` : ''}${d.pick(['Act as you judge best, but do not extend credit to the court.', 'Remit the balance by bill, not in coin.', 'Hold the stock until the new season.'])}`);
    lines.push('');
    lines.push(d.pick(['Farewell.', 'May the gods keep you.', 'Your friend and partner.']));
  }
  g.add({
    sub: 'letter', year, title: `Letter of ${g.T.short.get(`per:${head}`)} to an agent at ${g.T.short.get(`set:${partnerSet}`)}`, author: head, polity: P.id,
    lang, script: ctx.scriptOf(P, year), medium: era <= 1 ? 'clay tablet in envelope' : era <= 3 ? 'papyrus' : 'paper', cell: s.settlements[h.settlement].cell,
    settlement: h.settlement, about: [], body: lines.join('\n'), mentions: d.mentions, dateText: localDate(ctx, d, P, year), flagship: false,
    durable: era <= 1 ? 0.7 : 0.25, tau: era <= 1 ? 3500 : 1200, seat: h.settlement,
  });
}

export function houseLabel(kind: string, name: string): string {
  if (kind === 'company') return `the ${name} Company`;
  if (kind === 'bank') return `the ${name} Bank`;
  if (kind === 'corporation') return `the ${name} Corporation`;
  return `the house of ${name}`;
}

function pluralGood(good: number): boolean {
  return /s$/.test(GOODS[good].name);
}

export function fmtPrice(x: number): string {
  const a = Math.abs(x);
  if (a >= 1000) return Math.round(x).toLocaleString('en-US');
  if (a >= 100) return String(Math.round(x));
  if (a >= 10) return (Math.round(x * 10) / 10).toString();
  if (a >= 1) return (Math.round(x * 100) / 100).toString();
  return (Math.round(x * 1000) / 1000).toString();
}
