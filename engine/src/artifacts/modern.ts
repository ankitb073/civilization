// Documents of the print, telegraph and network ages, and the modern scholarship that edits the archive.
import type { Gen, Artifact } from './gen.ts';
import { fmt } from './gen.ts';
import { localDate } from '../archive/doc.ts';
import type { Polity, SimEvent } from '../sim/state.ts';
import { has, TK } from '../sim/tech.ts';
import { cap } from '../archive/context.ts';
import { Rng } from '../core/rng.ts';
import { GOODS } from '../sim/economy.ts';
import { fmtPrice } from './ledger.ts';

const PAPERS = ['Courier', 'Gazette', 'Herald', 'Intelligencer', 'Mercury', 'Chronicle', 'Observer', 'Messenger', 'Clarion', 'Tribune'];

export function genModern(g: Gen): void {
  genNewspapers(g);
  genTelegrams(g);
  genDebates(g);
  genMarketReports(g);
  genYearbooks(g);
  genPamphletsAndPatents(g);
  genScholarship(g);
}

function knows(p: Polity, key: string, year: number): boolean {
  const y = p.techs.get(TK[key]);
  return y !== undefined && y <= year;
}

// ---------------------------------------------------------------- newspapers
const NEWS_SUBS = new Set(['war', 'battle', 'treaty', 'revolution', 'panic', 'invention', 'plague', 'eruption', 'collapse', 'conquest', 'conversion', 'hyperinflation', 'trade-collapse', 'default', 'reform', 'currency-reform']);

function genNewspapers(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const last = new Map<number, number>();
  for (const e of s.events) {
    if (!NEWS_SUBS.has(e.sub) || e.sig < 0.3 || !g.T.pageRefs.has(`evt:${e.id}`)) continue;
    const pols = [...new Set(e.parts.filter(([r]) => r.startsWith('pol:')).map(([r]) => ctx.idNum(r)))];
    for (const pid of pols.slice(0, 2)) {
      const p = s.polities[pid];
      if (p.died !== null && p.died <= e.year) continue;
      if (!knows(p, 'printing', e.year)) continue;
      if ((last.get(pid) ?? -100) > e.year - 3) continue;
      last.set(pid, e.year);
      newspaper(g, p, e);
    }
  }
}

function headline(g: Gen, d: ReturnType<Gen['doc']>, e: SimEvent, p: Polity): { head: string; body: string } {
  const s = g.ctx.s;
  const first = (role: string) => e.parts.find(([, r]) => r === role)?.[0];
  const other = (pid: number) => e.parts.find(([r]) => r.startsWith('pol:') && r !== `pol:${pid}`)?.[0];
  const ours = (role: string) => first(role) === `pol:${p.id}`;
  switch (e.sub) {
    case 'war': {
      const o = other(p.id);
      return { head: `WAR WITH ${o ? d.nameOf(o).toUpperCase() : 'THE ENEMY'}`, body: `${ours('attacker') ? 'The government has declared war on' : 'Hostilities have been opened by'} ${o ? d.n(o) : 'a foreign power'}. ${d.pick(['Reservists are ordered to report to their depots.', 'Crowds gathered outside the ministry late into the night.', 'The exchange fell sharply on the news.'])} (${d.n(`evt:${e.id}`)})` };
    }
    case 'battle': {
      const won = e.data.winner === p.id;
      const near = first('near');
      const place = near ? d.nameOf(near).toUpperCase() : 'THE FRONT';
      const ourLoss = Number(ours('attacker') ? e.data.attackerLosses : e.data.defenderLosses);
      const theirLoss = Number(ours('attacker') ? e.data.defenderLosses : e.data.attackerLosses);
      return won
        ? { head: `VICTORY AT ${place}`, body: `Our forces have won a great victory${near ? ` near ${d.n(near)}` : ''}. Enemy losses are reported at ${fmt(theirLoss * (1.3 + g.rng.next()))}; our own at ${fmt(ourLoss * 0.7)}. (${d.n(`evt:${e.id}`)})` }
        : { head: `HEAVY FIGHTING AT ${place}`, body: `After a hard-fought engagement${near ? ` near ${d.n(near)}` : ''} our army has fallen back to prepared positions. ${d.pick(['The ministry denies reports of a rout.', 'Casualty lists will be posted at the town halls.', 'The censor has withheld further details.'])} (${d.n(`evt:${e.id}`)})` };
    }
    case 'treaty': return { head: `PEACE SIGNED`, body: `${d.n(`evt:${e.id}`)} has been concluded${first('signed at') ? ` at ${d.n(first('signed at')!)}` : ''}. ${ours('victor') ? 'Its terms are favourable to the nation.' : ours('vanquished') ? 'Its terms are described by the opposition as humiliating.' : 'Both parties express satisfaction.'}` };
    case 'revolution': return { head: `REVOLUTION IN ${d.nameOf(first('polity')!).toUpperCase()}`, body: `The old government has fallen. ${first('leader') ? `${d.n(first('leader')!)} heads a provisional administration.` : ''} (${d.n(`evt:${e.id}`)})` };
    case 'panic': return { head: `PANIC ON THE EXCHANGE`, body: `${e.data.failures} houses have suspended payment. ${d.pick(['Depositors besieged the banks at dawn.', 'The treasury has promised support.', 'Credit is unobtainable at any price.'])} (${d.n(`evt:${e.id}`)})` };
    case 'invention': return { head: `${(g.T.short.get(`tec:${e.data.tech}`) ?? 'A NEW INVENTION').toUpperCase()}`, body: `${first('inventor') ? d.n(first('inventor')!) : 'An inventor'} has demonstrated ${g.T.short.get(`tec:${e.data.tech}`)?.toLowerCase()} before ${d.pick(['the academy', 'a crowd of investors', 'the minister'])}. (${d.n(`evt:${e.id}`)})` };
    case 'plague': return { head: `${(g.T.plagueNames.get(e.id) ?? 'PESTILENCE').toUpperCase()}`, body: `The sickness has broken out${first('origin') ? ` at ${d.n(first('origin')!)}` : ''}. Ports are closing to ships from the stricken cities. (${d.n(`evt:${e.id}`)})` };
    case 'eruption': return { head: `SKIES DARKEN; CROPS FEARED LOST`, body: `A haze of ash covers the sky; the observatory reports the sun dimmed by a fifth. (${d.n(`evt:${e.id}`)})` };
    case 'collapse': return { head: `${d.nameOf(first('collapsed')!).toUpperCase()} IN DISSOLUTION`, body: `Provinces have declared their independence. (${d.n(`evt:${e.id}`)})` };
    case 'conquest': return { head: `${d.nameOf(first('vanquished') ?? first('annexed') ?? `pol:${p.id}`).toUpperCase()} ANNEXED`, body: `(${d.n(`evt:${e.id}`)})` };
    case 'hyperinflation': return { head: `CURRENCY COLLAPSES`, body: `Prices doubled again this week. Workers are paid twice a day. (${d.n(`evt:${e.id}`)})` };
    case 'trade-collapse': return { head: `TRADE AT A STANDSTILL`, body: `Shipping and caravan traffic have fallen by half. (${d.n(`evt:${e.id}`)})` };
    case 'default': return { head: `TREASURY SUSPENDS PAYMENTS`, body: `The government will not meet its obligations. (${d.n(`evt:${e.id}`)})` };
    default: return { head: (g.T.short.get(`evt:${e.id}`) ?? '').toUpperCase(), body: `(${d.n(`evt:${e.id}`)})` };
  }
  void s;
}

function newspaper(g: Gen, p: Polity, e: SimEvent): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const year = e.year;
  const lang = ctx.polityLang(p, year);
  const d = g.doc(lang, year, `news:${p.id}:${e.id}`);
  const capCity = ctx.capitalAt(p, year);
  const title = `The ${d.nameOf(`set:${capCity}`)} ${d.pick(PAPERS)}`;
  const items = [e];
  const others = s.events.filter((x) => x.year === year && x.id !== e.id && NEWS_SUBS.has(x.sub) && x.sig >= 0.35 && g.T.pageRefs.has(`evt:${x.id}`)).sort((a, b) => b.sig - a.sig).slice(0, 2);
  items.push(...others);
  const lines: string[] = [`**${title.toUpperCase()}**  ·  ${localDate(ctx, d, p, year).replace(/ \[AY \d+\]$/, '')}  ·  ${d.pick(['Price one copper', 'Morning edition', 'Late edition', 'Special edition'])}`, ''];
  for (const it of items) {
    const h = headline(g, d, it, p);
    lines.push(`### ${h.head}`, '', h.body, '');
  }
  const markets = g.price(capCity, GOODS.findIndex((x) => x.key === 'grain'), year);
  const cur = ctx.currencyAt(p.id, year);
  if (markets !== null && cur >= 0 && s.currencies[cur].born <= year) lines.push(`*Markets: grain ${fmtPrice(markets / ctx.contentAt(cur, year))} ${d.n(`cur:${cur}`)} the measure.*`);
  g.add({
    sub: 'newspaper', year, title: `${title}, AY ${year}: ${headline(g, g.doc(lang, year, `newsT:${e.id}`), e, p).head.toLowerCase().replace(/^./, (c) => c.toUpperCase())}`, author: null,
    polity: p.id, lang, script: ctx.scriptOf(p, year), medium: 'newsprint', cell: s.settlements[capCity].cell, settlement: capCity,
    about: items.map((x) => x.id), body: lines.join('\n'), mentions: d.mentions, dateText: localDate(ctx, d, p, year), flagship: false,
    durable: 0.8, tau: 3000, seat: capCity,
  });
}

// ---------------------------------------------------------------- telegrams
function genTelegrams(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const e of s.events) {
    if (e.sub !== 'battle') continue;
    for (const role of ['attacker', 'defender'] as const) {
      const pr = e.parts.find(([, r]) => r === role)?.[0];
      if (!pr) continue;
      const p = s.polities[ctx.idNum(pr)];
      if (!knows(p, 'telegraph', e.year)) continue;
      const rng = new Rng(s.seed).fork('telegram', e.id, role);
      if (!rng.chance(0.5)) continue;
      const cmd = e.parts.find(([, r]) => r === (role === 'attacker' ? 'attacking commander' : 'defending commander'))?.[0];
      if (!cmd) continue;
      const person = s.persons[ctx.idNum(cmd)];
      if (person.born + 16 > e.year || person.died < e.year) continue;
      const lang = ctx.polityLang(p, e.year);
      const d = g.doc(lang, e.year, `tg:${e.id}:${role}`);
      const won = e.data.winner === p.id;
      const near = e.parts.find(([, r]) => r === 'near')?.[0];
      const ownLoss = Number(role === 'attacker' ? e.data.attackerLosses : e.data.defenderLosses);
      const body = [
        `FROM ${d.n(cmd).toUpperCase()} TO MINISTRY OF WAR ${d.n(`set:${ctx.capitalAt(p, e.year)}`).toUpperCase()}`,
        '',
        `${won ? 'ENEMY BROKEN' : 'HEAVY PRESSURE'} ${near ? `NEAR ${d.n(near).toUpperCase()}` : 'ON CENTRE'} STOP ${won ? 'PURSUIT CONTINUING' : 'WITHDRAWING TO SECOND LINE'} STOP OUR LOSSES ABOUT ${fmt(ownLoss)} STOP ${won ? 'REQUEST REINFORCEMENTS TO EXPLOIT' : 'REQUEST AMMUNITION URGENTLY'} STOP`,
        '', '---', '', `**Editorial note.** Sent during the ${d.title(`evt:${e.id}`)}.`,
      ];
      g.add({
        sub: 'telegram', year: e.year, title: `Telegram of ${g.T.short.get(cmd)} from the ${g.T.short.get(`evt:${e.id}`)}`, author: person.id, polity: p.id, lang,
        script: ctx.scriptOf(p, e.year), medium: 'telegraph form', cell: e.cell, settlement: null, about: [e.id], body: body.join('\n'), mentions: d.mentions,
        dateText: localDate(ctx, d, p, e.year), flagship: false, durable: 0.7, tau: 3000, seat: ctx.capitalAt(p, e.year),
      });
    }
  }
}

// ---------------------------------------------------------------- parliamentary debates
const ASSEMBLY = ['republic', 'constitutional-monarchy', 'democracy', 'federation', 'merchant-republic'];

function genDebates(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const e of s.events) {
    if (e.sub !== 'war' && e.sub !== 'treaty') continue;
    const pr = e.parts.find(([r, role]) => r.startsWith('pol:') && (role === 'attacker' || role === 'vanquished' || role === 'victor'))?.[0];
    if (!pr) continue;
    const p = s.polities[ctx.idNum(pr)];
    if (!ASSEMBLY.includes(ctx.govAt(p, e.year)) || !knows(p, 'printing', e.year)) continue;
    const rng = new Rng(s.seed).fork('debate', e.id);
    if (!rng.chance(0.5)) continue;
    const year = e.year;
    const lang = ctx.polityLang(p, year);
    const d = g.doc(lang, year, `debate:${e.id}`);
    const head = ctx.rulerAt(p.id, year);
    const speakers = Array.from({ length: rng.int(3, 5) }, (_, i) => ctx.name(s.lang.coinName(lang, year, rng.chance(0.2) ? 'person-f' : 'person-m', `deputy:${e.id}:${i}`), lang, year));
    const motion = e.sub === 'war' ? `That this Assembly approves the declaration of war against ${d.n(e.parts.find(([, r]) => r === 'defender')![0])}` : `That this Assembly ratifies the ${d.n(`evt:${e.id}`)}`;
    const ayes = rng.int(120, 320), noes = rng.int(40, 260);
    const lines = [
      `*Official report of the Assembly of ${d.n(`pol:${p.id}`)}, ${localDate(ctx, d, p, year).replace(/ \[AY \d+\]$/, '')}.*`,
      '', `**Motion:** ${motion}.`, '',
      ...(head ? [`**${d.n(`per:${head.person}`)}** (head of government): ${e.sub === 'war' ? d.pick(['The nation has been provoked beyond endurance.', 'We seek no territory, only security.', 'Every peaceful means has been exhausted.']) : d.pick(['This peace is the best that could be had.', 'The terms are hard, but the alternative is ruin.', 'This treaty secures our frontiers for a generation.'])}`, ''] : []),
      ...speakers.map((n, i) => `**${n}:** ${i % 2 === 0 ? d.pick(['Who will pay for this? The farmer, as always.', 'I speak for the provinces, which were not consulted.', 'The honourable member forgets the last war.', 'Let us count the cost before we count the glory.']) : d.pick(['Hesitation now would be fatal.', 'The army is ready; is this Assembly?', 'We owe it to our allies.', 'History will judge us by this vote.'])}`),
      '', `**Division:** Ayes ${ayes}, Noes ${noes}. The motion was ${ayes > noes ? 'carried' : 'lost'}.`,
      '', '---', '', `**Editorial note.** ${ayes > noes ? '' : 'Despite the vote, the government proceeded. '}See ${d.title(`evt:${e.id}`)}.`,
    ];
    const capCity = ctx.capitalAt(p, year);
    g.add({
      sub: 'debate', year, title: `Assembly debate on the ${g.T.short.get(`evt:${e.id}`)}`, author: head ? head.person : null, polity: p.id, lang, script: ctx.scriptOf(p, year),
      medium: 'printed proceedings', cell: s.settlements[capCity].cell, settlement: capCity, about: [e.id], body: lines.join('\n'), mentions: d.mentions,
      dateText: localDate(ctx, d, p, year), flagship: false, durable: 0.85, tau: 6000, seat: capCity,
    });
  }
}

// ---------------------------------------------------------------- exchange reports
function genMarketReports(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const e of s.events) {
    if (e.sub !== 'panic' && e.sub !== 'hyperinflation' && e.sub !== 'currency-reform' && e.sub !== 'default') continue;
    const pr = e.parts.find(([r]) => r.startsWith('pol:'))?.[0];
    if (!pr) continue;
    const p = s.polities[ctx.idNum(pr)];
    if (!knows(p, 'printing', e.year) || !knows(p, 'banking', e.year)) continue;
    const year = e.year;
    const lang = ctx.polityLang(p, year);
    const d = g.doc(lang, year, `market:${e.id}`);
    const cur = ctx.currencyAt(p.id, year);
    if (cur < 0 || s.currencies[cur].born > year) continue;
    const home = ctx.contentAt(cur, year);
    const capCity = ctx.capitalAt(p, year);
    const rows: string[] = [];
    const seen = new Set<number>();
    for (const q of s.polities) {
      if (rows.length >= 8 || q.id === p.id || q.born > year || (q.died !== null && q.died <= year)) continue;
      const c = ctx.currencyAt(q.id, year);
      if (c < 0 || seen.has(c) || s.currencies[c].born > year) continue;
      seen.add(c);
      rows.push(`| ${d.n(`cur:${c}`)} (${d.n(`pol:${q.id}`)}) | ${fmtPrice(ctx.contentAt(c, year) / home)} |`);
    }
    const goods = GOODS.filter((x) => year >= x.from && year <= x.to).slice(0, 8);
    const gr = goods.map((x) => {
      const pp = g.price(capCity, x.id, year);
      return pp === null ? null : `| ${x.name} (${x.unit}) | ${fmtPrice(pp / home)} |`;
    }).filter(Boolean) as string[];
    const lines = [
      `*Closing quotations on the exchange of ${d.n(`set:${capCity}`)}, ${localDate(ctx, d, p, year).replace(/ \[AY \d+\]$/, '')}. Prices in ${d.n(`cur:${cur}`)}.*`,
      '', `${e.sub === 'panic' ? 'A day of panic.' : e.sub === 'hyperinflation' ? 'The currency fell again in heavy trading.' : e.sub === 'default' ? 'Government paper unsaleable.' : 'First day of dealings in the new unit.'} (${d.n(`evt:${e.id}`)})`,
      '', '**Foreign exchange** (units of our currency per unit)', '', '| Currency | Rate |', '|---|---|', ...rows,
      '', '**Commodities**', '', '| Commodity | Price |', '|---|---|', ...gr,
      '', '---', '', '**Editorial note.** Exchange rates follow the silver (or gold-equivalent) value of each currency at the date, as recorded on the currency pages.',
    ];
    g.add({
      sub: 'market', year, title: `Exchange report of ${g.T.short.get(`set:${capCity}`)}, AY ${year}`, author: null, polity: p.id, lang, script: ctx.scriptOf(p, year),
      medium: 'printed sheet', cell: s.settlements[capCity].cell, settlement: capCity, about: [e.id], body: lines.join('\n'), mentions: d.mentions,
      dateText: localDate(ctx, d, p, year), flagship: false, durable: 0.85, tau: 5000, seat: capCity,
    });
  }
}

// ---------------------------------------------------------------- statistical yearbooks
function genYearbooks(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const p of s.polities) {
    for (const row of ctx.polityStats.get(p.id) ?? []) {
      const y0 = row[1] as number;
      if (y0 % 30 !== 0 || (row[13] as number) < 5 || (row[2] as number) < 10) continue;
      const year = y0 + 3;
      if (year >= (p.died ?? 5000) || year >= 5000) continue;
      yearbook(g, p, year, row);
    }
  }
}

function yearbook(g: Gen, p: Polity, year: number, row: (number | string | null)[]): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const lang = ctx.polityLang(p, year);
  const d = g.doc(lang, year, `yb:${p.id}:${year}`);
  const cells: number[] = [];
  for (let c = 0; c < s.world.n; c++) if (ctx.ownerAt(c, year) === p.id) cells.push(c);
  const faiths = new Map<number, number>();
  for (const c of cells) { const r = ctx.religionAt(c, year); if (r >= 0) faiths.set(r, (faiths.get(r) ?? 0) + 1); }
  const cities = s.settlements.filter((t) => t.founded <= year && (t.abandoned ?? 9999) > year && ctx.ownerAt(t.cell, year) === p.id)
    .map((t) => [t, t.popHistory.filter(([y]) => y <= year).pop()?.[1] ?? t.pop] as const).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const cur = ctx.currencyAt(p.id, year);
  const lines = [
    `*Statistical Yearbook of ${d.n(`pol:${p.id}`)}, ${year}. Issued by the Statistical Office.*`,
    '', '| Item | Value |', '|---|---|',
    `| Population | ${fmt(row[3] as number)} |`,
    `| Area | ${fmt(cells.length * s.world.cellArea)} km² |`,
    `| Urban population | ${fmt(row[4] as number)} |`,
    `| Armed forces | ${fmt(row[6] as number)} |`,
    `| Government | ${String(row[8]).replace(/-/g, ' ')} |`,
    ...(cur >= 0 && s.currencies[cur].born <= year ? [`| Currency | ${d.n(`cur:${cur}`)} |`] : []),
    '', '**Principal cities**', '', '| City | Inhabitants |', '|---|---|', ...cities.map(([t, pop]) => `| ${d.n(`set:${t.id}`)} | ${fmt(pop)} |`),
    '', '**Religious affiliation** (share of districts)', '', '| Faith | Share |', '|---|---|',
    ...[...faiths].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([r, n]) => `| ${d.n(`mov:${r}`)} | ${Math.round((n / cells.length) * 100)}% |`),
  ];
  const capCity = ctx.capitalAt(p, year);
  g.add({
    sub: 'yearbook', year, title: `Statistical Yearbook of ${g.T.short.get(`pol:${p.id}`)}, ${year}`, author: null, polity: p.id, lang, script: ctx.scriptOf(p, year),
    medium: 'printed volume', cell: s.settlements[capCity].cell, settlement: capCity, about: [], body: lines.join('\n'), mentions: d.mentions,
    dateText: localDate(ctx, d, p, year), flagship: false, durable: 0.95, tau: 9000, seat: capCity,
  });
}

// ---------------------------------------------------------------- pamphlets and patents
function genPamphletsAndPatents(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const e of s.events) {
    if (e.sub === 'invention') {
      const p = s.polities[ctx.idNum(e.parts.find(([, r]) => r === 'polity')![0])];
      const inv = e.parts.find(([, r]) => r === 'inventor')?.[0];
      if (!inv || !knows(p, 'printing', e.year)) continue;
      const lang = ctx.polityLang(p, e.year);
      const d = g.doc(lang, e.year, `patent:${e.id}`);
      const tech = g.T.short.get(`tec:${e.data.tech}`) ?? '';
      const lines = [
        `**Specification of ${d.n(inv)}**, of ${d.n(`set:${ctx.capitalAt(p, e.year)}`)}: *${cap(tech.replace(/^The /, ''))}, an improved method and apparatus.*`,
        '', `To all to whom these presents shall come: I, ${d.n(inv)}, have invented ${d.pick(['new and useful improvements in', 'a new method of', 'an apparatus for'])} ${tech.toLowerCase()}, of which the following is a full and exact description.`,
        '', `1. ${d.pick(['The working parts are arranged so that', 'The principal novelty consists in that', 'Whereas former methods required great labour,'])} ${d.pick(['the force is applied continuously rather than by intervals', 'the loss of heat is reduced by one half', 'a single operator may do the work of twelve', 'the signal is carried over any distance without loss'])}.`,
        `2. ${d.pick(['Drawings are annexed.', 'A working model is deposited at the office.', 'The claims are limited to the arrangement described.'])}`,
        '', '---', '', `**Editorial note.** See ${d.title(`evt:${e.id}`)}.`,
      ];
      const capCity = ctx.capitalAt(p, e.year);
      g.add({
        sub: 'patent', year: e.year, title: `Patent of ${g.T.short.get(inv)}: ${tech}`, author: ctx.idNum(inv), polity: p.id, lang, script: ctx.scriptOf(p, e.year),
        medium: 'printed specification', cell: s.settlements[capCity].cell, settlement: capCity, about: [e.id], body: lines.join('\n'), mentions: d.mentions,
        dateText: localDate(ctx, d, p, e.year), flagship: false, durable: 0.9, tau: 7000, seat: capCity,
      });
    }
    if (e.sub === 'revolution' || (e.sub === 'movement-founding' && (e.data.kind === 'ideology' || e.data.kind === 'reform'))) {
      const pr = e.parts.find(([r, role]) => r.startsWith('pol:') && (role === 'polity'))?.[0];
      if (!pr) continue;
      const p = s.polities[ctx.idNum(pr)];
      if (!knows(p, 'printing', e.year)) continue;
      const leader = e.parts.find(([, r]) => r === 'leader' || r === 'founder')?.[0];
      const lang = ctx.polityLang(p, e.year);
      const d = g.doc(lang, e.year, `pamphlet:${e.id}`);
      const mov = e.parts.find(([, r]) => r === 'movement')?.[0];
      const lines = [
        `# ${d.pick(['A Word to the People of', 'An Appeal to the Citizens of', 'The Hour Has Come for'])} ${d.n(`pol:${p.id}`)}`,
        '', `${d.pick(['Citizens!', 'Brothers and sisters!', 'Workers of town and field!'])} ${d.pick(['How long will you bear the yoke?', 'Look around you: who owns the land you till?', 'They tell you to be patient. You have been patient for a thousand years.'])}`,
        '', `${mov ? `The ${d.n(mov)} ` : 'We '}${d.pick(['demands', 'proclaims', 'calls for'])}: ${d.pick(['bread, land and peace', 'a constitution and an elected assembly', 'the end of privilege by birth', 'the nation united under one law'])}. ${d.pick(['Read this, and pass it on.', 'Meet in the squares on the first day of the month.', 'Do not fear the police; there are more of us than of them.'])}`,
        '', leader ? `*${d.n(leader)}*` : '*The Committee*',
      ];
      const capCity = ctx.capitalAt(p, e.year);
      g.add({
        sub: 'pamphlet', year: e.year, title: `Pamphlet: ${g.T.short.get(`evt:${e.id}`)}`, author: leader ? ctx.idNum(leader) : null, polity: p.id, lang,
        script: ctx.scriptOf(p, e.year), medium: 'printed pamphlet', cell: s.settlements[capCity].cell, settlement: capCity, about: [e.id], body: lines.join('\n'),
        mentions: d.mentions, dateText: localDate(ctx, d, p, e.year), flagship: false, durable: 0.55, tau: 2000, seat: capCity,
      });
    }
  }
}

// ---------------------------------------------------------------- modern scholarship
function scholarAt(g: Gen, lo: number, hi: number, rng: Rng): { id: number; year: number } | null {
  const s = g.ctx.s;
  const cands = g.scholars.filter((id) => s.persons[id].born + 28 <= hi && s.persons[id].died >= lo + 1);
  if (!cands.length) return null;
  const id = rng.pick(cands);
  const p = s.persons[id];
  const year = rng.int(Math.max(lo, p.born + 28), Math.min(hi, p.died, 4999));
  return { id, year };
}

function genScholarship(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const ed = s.polities[ctx.editorialPolity];
  const lang = ctx.editorialLang;
  const rng = new Rng(s.seed).fork('scholarship');
  // comparative linguistics: one paper per family with three or more daughters
  const langs = s.lang.languages();
  const roots = langs.filter((l) => l.parent === null);
  for (const root of roots) {
    const leaves = langs.filter((l) => l.family === root.family && l.parent !== null && !langs.some((x) => x.parent === l.id));
    if (leaves.length < 3) continue;
    const who = scholarAt(g, 4880, 4995, rng.fork(root.id));
    if (!who) continue;
    const d = g.doc(lang, who.year, `ling:${root.id}`);
    const sample = leaves.slice(0, 6);
    const concepts = ['water', 'fire', 'mother', 'king', 'god', 'river', 'stone', 'two', 'three', 'sun', 'house', 'silver'];
    const lines = [
      `${d.n(`per:${who.id}`)}. *Regular sound correspondences in the ${d.title(`lan:${root.id}`).replace(/\]\]$/, ']]')} family.* Journal of Comparative Philology, ${who.year}.`,
      '', '## Abstract', '',
      `Cognate sets from ${sample.length} attested languages allow a reconstruction of the parent language. The correspondences are regular, and the sound changes that produced them can be dated against the epigraphic record.`,
      '', '## Cognate sets', '',
      `| Meaning | *Proto | ${sample.map((l) => d.link(`lan:${l.id}`, g.T.short.get(`lan:${l.id}`) ?? '')).join(' | ')} |`,
      `|---|---|${sample.map(() => '---').join('|')}|`,
      ...concepts.map((c) => `| ${c} | ${s.lang.protoForm(root.id, c)} | ${sample.map((l) => s.lang.word(l.id, c, Math.min(l.died ?? 5000, 5000)).conventional).join(' | ')} |`),
      '', '## Dated sound laws', '',
      ...sample.slice(0, 3).flatMap((l) => {
        const ch = s.lang.soundChanges(l.id).filter((c) => c.lang !== root.id).slice(0, 4);
        return ch.length ? [`**${g.T.short.get(`lan:${l.id}`)}:** ${ch.map((c) => `${c.label} (\`${c.rule}\`, c. AY ${c.year})`).join('; ')}.`, ''] : [];
      }),
    ];
    g.add({
      sub: 'paper', year: who.year, title: `Regular sound correspondences in the ${g.T.short.get(`lan:${root.id}`)} family`, author: who.id, polity: ed.id, lang,
      script: ctx.scriptOf(ed, who.year), medium: 'journal article', cell: s.settlements[ed.capital].cell, settlement: ed.capital, about: [],
      body: lines.join('\n'), mentions: d.mentions, dateText: localDate(ctx, d, ed, who.year), flagship: false, durable: 0.99, tau: 99999, seat: ed.capital,
    });
  }
  // palaeoclimate: the largest eruptions and the long temperature record
  const big = s.anomalies.filter((a) => a.kind === 'eruption' && a.severity >= 7).slice(0, 4);
  const who = scholarAt(g, 4900, 4998, rng.fork('climate'));
  if (who) {
    const d = g.doc(lang, who.year, 'climate-paper');
    const byMill = [0, 1000, 2000, 3000, 4000, 4500, 4800, 4900].map((y0) => {
      const xs = s.climate.filter((c) => c.year >= y0 && c.year < (y0 >= 4800 ? y0 + 100 : y0 >= 4000 ? y0 + 500 : y0 + 1000));
      return [y0, xs.reduce((a, c) => a + c.temp, 0) / Math.max(1, xs.length)] as const;
    });
    const lines = [
      `${d.n(`per:${who.id}`)}. *Five thousand years of climate from ice cores and tree rings.* Annals of Climate Science, ${who.year}.`,
      '', '## Results', '',
      '| Period | Mean temperature anomaly (°C) |', '|---|---|',
      ...byMill.map(([y, t]) => `| from AY ${y} | ${t >= 0 ? '+' : ''}${t.toFixed(2)} |`),
      '', `Sulfate spikes mark ${big.length} eruptions of magnitude 7: ${big.map((a) => d.title(`cli:${a.id}`)).join(', ') || 'none'}. Each was followed by two decades of cooling and, in the dry interior, famine.`,
      '', `Since the spread of the steam engine the record shows a warming without precedent in the archive (${d.title(`cli:${s.anomalies.find((a) => a.kind === 'warming')?.id ?? 0}`)}).`,
    ];
    g.add({
      sub: 'paper', year: who.year, title: 'Five thousand years of climate from ice cores and tree rings', author: who.id, polity: ed.id, lang, script: ctx.scriptOf(ed, who.year),
      medium: 'journal article', cell: s.settlements[ed.capital].cell, settlement: ed.capital, about: big.map((a) => a.event), body: lines.join('\n'), mentions: d.mentions,
      dateText: localDate(ctx, d, ed, who.year), flagship: false, durable: 0.99, tau: 99999, seat: ed.capital,
    });
  }
  // economic history: the most debased coin
  const deb = s.currencies.filter((c) => c.kind === 'coin' && c.history.length > 2).sort((a, b) => a.history[a.history.length - 1][1] / a.history[0][1] - b.history[b.history.length - 1][1] / b.history[0][1])[0];
  const who2 = scholarAt(g, 4880, 4998, rng.fork('econ'));
  if (deb && who2) {
    const d = g.doc(lang, who2.year, 'econ-paper');
    const lines = [
      `${d.n(`per:${who2.id}`)}. *The debasement of the ${d.title(`cur:${deb.id}`)} and the price of bread.* Economic History Review, ${who2.year}.`,
      '', '| Year | Silver per coin (g) |', '|---|---|', ...deb.history.slice(0, 20).map(([y, v]) => `| AY ${y} | ${v} |`),
      '', `Over ${deb.history[deb.history.length - 1][0] - deb.history[0][0]} years the coin lost ${Math.round((1 - deb.history[deb.history.length - 1][1] / deb.history[0][1]) * 100)}% of its silver. Merchant ledgers of the period show prices in the coin rising in step, while prices in silver weight barely moved.`,
    ];
    g.add({
      sub: 'paper', year: who2.year, title: `The debasement of the ${g.T.short.get(`cur:${deb.id}`)}`, author: who2.id, polity: ed.id, lang, script: ctx.scriptOf(ed, who2.year),
      medium: 'journal article', cell: s.settlements[ed.capital].cell, settlement: ed.capital, about: [], body: lines.join('\n'), mentions: d.mentions,
      dateText: localDate(ctx, d, ed, who2.year), flagship: false, durable: 0.99, tau: 99999, seat: ed.capital,
    });
  }
}

/** After survival: one report per excavation, listing the finds. */
export function genExcavationReports(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const ed = s.polities[ctx.editorialPolity];
  const lang = ctx.editorialLang;
  const finds = new Map<number, Artifact[]>();
  for (const a of g.artifacts) {
    if (a.status !== 'extant' || a.foundYear === null) continue;
    for (const m of a.mentions) {
      if (!m.startsWith('evt:')) continue;
      const e = s.events[ctx.idNum(m)];
      if (e.sub !== 'excavation') continue;
      if (!finds.has(e.id)) finds.set(e.id, []);
      finds.get(e.id)!.push(a);
    }
  }
  for (const [eid, arts] of finds) {
    const e = s.events[eid];
    const site = ctx.idNum(e.parts.find(([, r]) => r === 'site')![0]);
    const by = ctx.idNum(e.parts.find(([, r]) => r === 'excavator')![0]);
    const t = s.settlements[site];
    const year = Math.min(4999, e.year + 2);
    if (s.persons[by].died < year) continue;
    const d = g.doc(lang, year, `exc:${eid}`);
    const destr = t.sacks.map((x) => s.events[x]).filter((x) => x.year < e.year).sort((a, b) => a.year - b.year);
    const strata = [
      `Stratum I (top): ${t.abandoned !== null && t.abandoned < e.year ? `abandonment fill after AY ${t.abandoned}` : 'the modern town'}.`,
      ...destr.slice(-4).reverse().map((x, i) => `Stratum ${i + 2}: burnt destruction layer, ash and fallen brick, dated to AY ${x.year} (${d.title(`evt:${x.id}`)}).`),
      `Lowest stratum: foundation of the city, c. AY ${t.founded}.`,
    ];
    const lines = [
      `${d.n(`per:${by}`)}. *Excavations at ${d.n(`set:${site}`)}: preliminary report.* ${year}.`,
      '', `The site of ancient ${d.ed(`set:${site}`)} was excavated in AY ${e.year}${destr.length ? `. ${destr.length} destruction layers were identified` : ''}.`,
      '', '## Stratigraphy', '', ...strata.map((x) => `- ${x}`),
      '', `## Inscribed finds (${arts.length})`, '', ...arts.slice(0, 40).map((a) => `- [[art:${a.id}|${a.catalog}]]: ${a.title} (AY ${a.year})`),
    ];
    g.add({
      sub: 'excavation', year, title: `Excavations at ${g.T.short.get(`set:${site}`)} (AY ${e.year})`, author: by, polity: ed.id, lang, script: ctx.scriptOf(ed, year),
      medium: 'printed report', cell: t.cell, settlement: site, about: [eid], body: lines.join('\n'), mentions: d.mentions, dateText: localDate(ctx, d, ed, year),
      flagship: false, durable: 1, tau: 99999, seat: null,
    });
    const a = g.artifacts[g.artifacts.length - 1];
    a.status = 'extant';
    a.provenance = `Published by the excavator, AY ${year}.`;
    a.condition = 'Complete.';
  }
  void has;
}
