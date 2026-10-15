// Further document types: decrees, annals, censuses, temple and weather records, coin catalogue
// entries, travelogues, diplomatic letters, scriptures, council acts and polemics.
import type { Gen } from './gen.ts';
import { fmt, money, goodName } from './gen.ts';
import type { Doc } from '../archive/doc.ts';
import { localDate } from '../archive/doc.ts';
import type { Polity, SimEvent, Movement } from '../sim/state.ts';
import { cap, ordinal } from '../archive/context.ts';
import { Rng } from '../core/rng.ts';
import { GOODS } from '../sim/economy.ts';
import { fmtPrice } from './ledger.ts';
import { tenetText } from '../archive/pages.ts';
import { genModern } from './modern.ts';

const GRAIN = GOODS.findIndex((g) => g.key === 'grain');

export function genMore(g: Gen): void {
  genDecrees(g);
  genAnnals(g);
  genCensuses(g);
  genRecords(g);
  genCoins(g);
  genTravelogues(g);
  genDiplomaticLetters(g);
  genScriptures(g);
  genModern(g);
}

function literate(g: Gen, p: Polity, year: number): boolean {
  return g.ctx.scriptOf(p, year) >= 0;
}

function issuer(g: Gen, p: Polity, year: number): { author: number; byRuler: boolean } {
  const r = g.ctx.rulerAt(p.id, year);
  if (r) {
    const x = g.ctx.s.persons[r.person];
    if (x.born + 16 <= year && x.died >= year) return { author: x.id, byRuler: true };
  }
  return { author: g.author(p, 'scribe', year).id, byRuler: false };
}

function medium(era: number, rng: Rng, kind: 'stone' | 'soft' | 'any'): { medium: string; durable: number; tau: number } {
  if (era <= 1) return kind === 'stone' ? { medium: 'stone stele', durable: 0.85, tau: 6000 } : { medium: 'clay tablet', durable: 0.7, tau: 3500 };
  if (era <= 3) return kind === 'stone' ? { medium: 'inscribed stone', durable: 0.8, tau: 5000 } : rng.chance(0.5) ? { medium: 'parchment', durable: 0.35, tau: 1500 } : { medium: 'papyrus', durable: 0.25, tau: 1200 };
  if (era === 4) return { medium: rng.chance(0.6) ? 'printed broadsheet' : 'manuscript register', durable: 0.6, tau: 2500 };
  return { medium: 'printed gazette', durable: 0.85, tau: 6000 };
}

// ---------------------------------------------------------------- decrees
function genDecrees(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const e of s.events) {
    const kinds = ['coinage', 'debasement', 'conversion', 'persecution', 'famine', 'revolution', 'paper-money', 'currency-reform'];
    if (!kinds.includes(e.sub)) continue;
    const polRef = e.parts.find(([r, role]) => r.startsWith('pol:') && ['issuer', 'polity', 'persecutor', 'stricken'].includes(role))?.[0];
    if (!polRef) continue;
    const p = s.polities[ctx.idNum(polRef)];
    if (p.born > e.year || (p.died !== null && p.died < e.year) || !literate(g, p, e.year)) continue;
    const rng = new Rng(s.seed).fork('decree', e.id);
    if (e.sub === 'famine' && !rng.chance(0.5)) continue;
    if (e.sub === 'coinage' && !rng.chance(0.6)) continue;
    decree(g, e, p, rng);
  }
}

function decree(g: Gen, e: SimEvent, p: Polity, rng: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const year = e.year;
  const lang = ctx.polityLang(p, year);
  const d = g.doc(lang, year, `decree:${e.id}`);
  const era = ctx.eraAt(p.id, year);
  const { author, byRuler } = issuer(g, p, year);
  const voice = byRuler ? (era <= 1 ? `Thus says ${d.n(`per:${author}`)}, king of ${d.n(`pol:${p.id}`)}:` : era <= 3 ? `${d.n(`per:${author}`)}, by the grace of the gods ruler of ${d.n(`pol:${p.id}`)}, to all who hear these words, greeting.` : `By order of the government of ${d.n(`pol:${p.id}`)}:`) : `The chancery of ${d.n(`pol:${p.id}`)} proclaims:`;
  const lines: string[] = [voice, ''];
  const first = (role: string) => e.parts.find(([, r]) => r === role)?.[0];
  let title = '';
  switch (e.sub) {
    case 'coinage': case 'paper-money': case 'currency-reform': {
      const cur = first('currency')!;
      const c = s.currencies[ctx.idNum(cur)];
      title = e.sub === 'coinage' ? `Edict on the striking of the ${g.T.short.get(cur)}` : e.sub === 'paper-money' ? `Edict on the issue of ${g.T.short.get(cur)} notes` : `Currency law of AY ${year}`;
      if (e.sub === 'coinage') lines.push(`Let there be struck in the workshop of the palace a coin of ${c.metal}, of the weight of ${fmt(c.content)} grains of the royal standard, to be called ${d.n(cur)}. ${d.pick(['It shall bear the image of the king and the sign of the city.', 'On the one face the king, on the other the god of the city.', 'Each shall be weighed and sealed before it leaves the workshop.'])}`);
      else if (e.sub === 'paper-money') lines.push(`Notes of the treasury, to be called ${d.n(cur)}, shall pass in all payments at their face value and shall be received for taxes. ${d.pick(['Whoever refuses them shall be fined.', 'Whoever counterfeits them shall die.', 'They may be exchanged for coin at the treasury on demand.'])}`);
      else lines.push(`The new unit of account, the ${d.n(cur)}, replaces the old at the rate fixed by the treasury. All contracts shall be read as if written in the new unit.`);
      lines.push('', `Given ${localDate(ctx, d, p, year)}.`);
      break;
    }
    case 'debasement': {
      const cur = first('currency')!;
      title = `Edict on the new ${g.T.short.get(cur)}`;
      lines.push(`Because the treasury is empty ${d.pick(['on account of the war', 'through the costs of the realm', 'by the malice of the enemy'])}, the ${d.n(cur)} shall henceforth be struck at ${fmt(Number(e.data.after))} grains of silver. It shall pass at the full value of the old coin. ${d.pick(['Whoever refuses it in the market shall be beaten.', 'Merchants who raise their prices shall be fined double.', 'Whoever melts the old coin shall forfeit his goods.'])}`);
      const war = e.causes.find((c) => s.events[c].sub === 'war');
      if (war !== undefined) lines.push('', `*(The edict follows the outbreak of the ${d.title(`evt:${war}`)}.)*`);
      lines.push('', `Given ${localDate(ctx, d, p, year)}.`);
      break;
    }
    case 'conversion': {
      const m = first('adopted')!;
      title = `Edict establishing the ${g.T.short.get(m)}`;
      lines.push(`From this day the ${d.n(m)} is the faith of ${d.n(`pol:${p.id}`)}. ${d.pick(['Its priests shall be fed from the royal granaries.', 'Its shrines shall be built in every city of the realm.', 'Its feasts shall be kept as the feasts of the king.'])} ${first('abandoned') ? `The rites of the ${d.n(first('abandoned')!)} ${d.pick(['may continue in private', 'shall no longer be paid for by the treasury', 'shall be kept only in the old temples'])}.` : ''}`);
      lines.push('', `Given ${localDate(ctx, d, p, year)}.`);
      break;
    }
    case 'persecution': {
      const m = first('persecuted')!;
      title = `Edict against the ${g.T.short.get(m)}`;
      lines.push(`The followers of the ${d.n(m)} ${d.pick(['corrupt the people', 'deny the gods of the city', 'refuse the sacrifices owed to the king'])}. They shall not assemble, nor teach, nor keep their books. ${d.pick(['Their houses of prayer shall be closed.', 'Those who recant shall be pardoned.', 'Their goods shall pass to the treasury.'])} The ${d.n(first('establishment')!)} alone shall be honoured.`);
      lines.push('', `Given ${localDate(ctx, d, p, year)}.`);
      break;
    }
    case 'famine': {
      const cap0 = ctx.capitalAt(p, year);
      const pr = g.price(cap0, GRAIN, year);
      const cur = ctx.currencyAt(p.id, year);
      if (pr === null) return;
      const curOk = cur >= 0 && s.currencies[cur].born <= year;
      const grams = curOk ? ctx.contentAt(cur, year) : 8.3;
      const ceiling = (pr / grams) * 0.7;
      title = `Edict on the price of grain, AY ${year}`;
      lines.push(`Because of the ${d.n(`evt:${e.id}`)}, no man in ${d.n(`pol:${p.id}`)} shall sell grain above ${fmtPrice(ceiling)} ${curOk ? d.n(`cur:${cur}`) : 'shekels of silver'} the measure. ${d.pick(['The granaries of the palace shall be opened to the poor.', 'Whoever hoards grain shall forfeit it.', 'Ships carrying grain shall pay no toll.'])}`);
      lines.push('', `Given ${localDate(ctx, d, p, year)}.`);
      lines.push('', '---', '', `**Editorial note.** The market price of grain at ${d.ed(`set:${cap0}`)} that decade was about ${fmtPrice(pr / grams)} the measure; the ceiling was set some 30% below it.`);
      break;
    }
    case 'revolution': {
      title = `Proclamation of the ${g.T.short.get(`evt:${e.id}`)}`;
      const to = String(e.data.to).replace(/-/g, ' ');
      lines.splice(0, 2, `To the people of ${d.n(`pol:${p.id}`)}:`, '');
      lines.push(`The old order is ended. ${d.pick(['Power returns to the people from whom it came.', 'No man shall again rule by birth alone.', 'The nation takes its destiny into its own hands.'])} ${cap(govNoun(to))} is established${first('leader') ? `, and ${d.n(first('leader')!)} shall lead the provisional government` : ''}. ${d.pick(['Let every citizen return to work in peace.', 'Let the soldiers return to their barracks.', 'Let the bells ring in every town.'])}`);
      lines.push('', `${localDate(ctx, d, p, year)}.`);
      break;
    }
  }
  const m = medium(era, rng, e.sub === 'conversion' || e.sub === 'debasement' ? 'any' : 'soft');
  const capCity = ctx.capitalAt(p, year);
  g.add({
    sub: 'decree', year, title, author, polity: p.id, lang, script: ctx.scriptOf(p, year), medium: m.medium, cell: s.settlements[capCity].cell,
    settlement: capCity, about: [e.id], body: lines.join('\n'), mentions: d.mentions, dateText: localDate(ctx, d, p, year), flagship: false,
    durable: m.durable, tau: m.tau, seat: capCity,
  });
}

function govNoun(to: string): string {
  if (to.includes('republic')) return 'the republic';
  if (to.includes('constitutional')) return 'a constitutional monarchy';
  if (to.includes('one party')) return 'the people\'s state';
  if (to.includes('democracy')) return 'the commonwealth';
  return to;
}

// ---------------------------------------------------------------- annals
function genAnnals(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const keep = new Set(['war', 'battle', 'treaty', 'conquest', 'succession', 'usurpation', 'famine', 'plague', 'eruption', 'founding-city', 'conversion', 'revolt', 'collapse', 'sack', 'siege', 'migration', 'marriage', 'coinage', 'debasement', 'invention', 'capital-move', 'movement-founding']);
  for (const p of s.polities) {
    for (let c = Math.floor(p.born / 100); c * 100 < (p.died ?? 5000); c++) {
      const from = Math.max(p.born, c * 100), to = Math.min((p.died ?? 5000) - 1, c * 100 + 99);
      if (to - from < 30 || !literate(g, p, to)) continue;
      const rng = new Rng(s.seed).fork('annals', p.id, c);
      if (!rng.chance(0.45)) continue;
      const evs = (ctx.eventsByRef.get(`pol:${p.id}`) ?? []).map((i) => s.events[i]).filter((e) => e.year >= from && e.year <= to && keep.has(e.sub) && g.T.pageRefs.has(`evt:${e.id}`)).sort((a, b) => a.year - b.year || a.id - b.id);
      if (evs.length < 4) continue;
      annals(g, p, from, to, evs, rng);
    }
  }
}

function annals(g: Gen, p: Polity, from: number, to: number, evs: SimEvent[], rng: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const year = to;
  const lang = ctx.polityLang(p, year);
  const d = g.doc(lang, year, `annals:${p.id}:${from}`);
  const author = g.author(p, 'scribe', year);
  const era = ctx.eraAt(p.id, year);
  const lines: string[] = [];
  lines.push(`*${d.pick(['These are the deeds of the years', 'The record of the years', 'Here begin the annals'])} of ${d.n(`pol:${p.id}`)}, from ${localDate(ctx, d, p, from).replace(/ \[AY \d+\]$/, '')} to ${localDate(ctx, d, p, to).replace(/ \[AY \d+\]$/, '')}.*`);
  lines.push('');
  const self = `pol:${p.id}`;
  const roleOf = (e: SimEvent) => e.parts.find(([r]) => r === self)?.[1];
  const chosen = evs.length > 28 ? evs.filter((e) => e.sig > 0.12 || rng.chance(0.4)).slice(0, 28) : evs;
  for (const e of chosen) {
    const when = cap(localDate(ctx, d, p, e.year).replace(/ \[AY \d+\]$/, ''));
    const role = roleOf(e);
    let line = '';
    const other = (roles: string[]) => {
      const r = e.parts.find(([x, rr]) => x !== self && x.startsWith('pol:') && roles.includes(rr))?.[0];
      return r ? d.n(r) : 'the enemy';
    };
    switch (e.sub) {
      case 'war': line = role === 'attacker' ? `The king went to war against ${other(['defender'])}.` : `${cap(other(['attacker']))} ${d.pick(['came up against the land', 'broke the peace', 'raided the border'])}.`; break;
      case 'battle': {
        const won = e.data.winner === p.id;
        const near = e.parts.find(([, r]) => r === 'near')?.[0];
        if (!won && rng.chance(0.6)) continue;
        line = won ? `There was a battle${near ? ` at ${d.n(near)}` : ''}; ${d.pick(['the army of the king prevailed', 'the enemy fled', 'the gods gave the victory'])}.` : `There was a battle${near ? ` at ${d.n(near)}` : ''}; ${d.pick(['many fell', 'the army withdrew', 'it went ill'])}.`;
        break;
      }
      case 'treaty': line = `Peace was sworn: ${d.n(`evt:${e.id}`)}.`; break;
      case 'conquest': line = role === 'victor' ? `${cap(other(['vanquished']))} was taken and made part of the land.` : `The realm fell.`; break;
      case 'succession': {
        const succ = e.parts.find(([, r]) => r === 'successor')?.[0];
        const pred = e.parts.find(([, r]) => r === 'predecessor')?.[0];
        line = `${pred ? d.n(pred) : 'The king'} ${d.pick(['went to his fate', 'died', 'was gathered to his fathers'])}; ${succ ? d.n(succ) : 'his heir'} sat on the throne${e.data.regency ? ', being a child' : ''}.`;
        break;
      }
      case 'usurpation': { const succ = e.parts.find(([, r]) => r === 'successor')?.[0]; line = `${succ ? d.n(succ) : 'A usurper'} seized the throne.`; break; }
      case 'famine': line = `${d.pick(['The harvest failed', 'There was hunger in the land', 'Grain was dear'])}${e.causes.some((c) => s.events[c].sub === 'drought') ? '; the rains did not come' : ''}.`; break;
      case 'plague': line = `${d.pick(['A sickness came', 'Pestilence struck the cities', 'The dead lay unburied'])}: ${d.n(`evt:${e.id}`)}.`; break;
      case 'eruption': line = `${d.pick(['The sun was darkened', 'Ash fell from the sky', 'There was no summer'])}.`; break;
      case 'founding-city': { const t = e.parts.find(([, r]) => r === 'settlement')?.[0]; line = `The city of ${t ? d.n(t) : ''} was founded.`; break; }
      case 'conversion': line = `The king ${d.pick(['turned to', 'embraced', 'gave honour to'])} the ${d.n(e.parts.find(([, r]) => r === 'adopted')![0])}.`; break;
      case 'revolt': line = `The ${d.pick(['provinces', 'lords of the border', 'people of the hills'])} rose in revolt.`; break;
      case 'sack': line = `${d.n(e.parts.find(([, r]) => r === 'settlement')![0])} was ${role === 'besieger' ? 'taken and plundered by the army' : 'sacked by the enemy'}.`; break;
      case 'marriage': line = `A marriage was made with the house of ${other(['house'])}.`; break;
      case 'coinage': line = `The king struck coin.`; break;
      case 'debasement': line = `The coin was made light.`; break;
      case 'invention': line = `${cap(g.T.short.get(`tec:${e.data.tech}`) ?? 'A new art')} was devised.`; break;
      case 'capital-move': { const t = e.parts.find(([, r]) => r === 'to')?.[0]; line = `The king moved his seat to ${t ? d.n(t) : 'a new city'}.`; break; }
      case 'movement-founding': { const m = e.parts.find(([, r]) => r === 'movement')?.[0]; line = `A teacher arose, preaching ${m ? `the ${d.n(m)}` : 'a new way'}.`; break; }
      default: continue;
    }
    lines.push(`- **${when}.** ${line}`);
  }
  lines.push('');
  lines.push(`*Written by ${d.n(`per:${author.id}`)}, ${era <= 1 ? 'scribe of the house of tablets' : 'keeper of the annals'}.*`);
  lines.push('', '---', '', `**Editorial note.** Court annals record what the court wished remembered. Of the ${evs.filter((e) => e.sub === 'battle').length} battles in which ${d.ed(`pol:${p.id}`)} fought in these years, the annalist mentions ${chosen.filter((e) => e.sub === 'battle').length}.`);
  const m = medium(era, rng, 'soft');
  const capCity = ctx.capitalAt(p, year);
  g.add({
    sub: 'annals', year, title: `Annals of ${g.T.short.get(`pol:${p.id}`)}, AY ${from}–${to}`, author: author.id, polity: p.id, lang, script: ctx.scriptOf(p, year),
    medium: m.medium, cell: s.settlements[capCity].cell, settlement: capCity, about: chosen.map((e) => e.id), body: lines.join('\n'), mentions: d.mentions,
    dateText: localDate(ctx, d, p, year), flagship: false, durable: m.durable, tau: m.tau, seat: capCity,
  });
}

// ---------------------------------------------------------------- censuses
function genCensuses(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const p of s.polities) {
    const stats = ctx.polityStats.get(p.id) ?? [];
    for (const row of stats) {
      const year = (row[1] as number) + 5;
      if ((row[1] as number) % 100 !== 50 || (row[2] as number) < 12 || (row[13] as number) < 1 || year > (p.died ?? 5000) - 1) continue;
      if (!literate(g, p, year)) continue;
      const rng = new Rng(s.seed).fork('census', p.id, year);
      if (!rng.chance(0.3)) continue;
      census(g, p, year, row, rng);
    }
  }
}

function census(g: Gen, p: Polity, year: number, row: (number | string | null)[], rng: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const lang = ctx.polityLang(p, year);
  const d = g.doc(lang, year, `census:${p.id}:${year}`);
  const author = g.author(p, 'scribe', year);
  const era = ctx.eraAt(p.id, year);
  const total = row[3] as number;
  // regional shares by carrying capacity of the territory held that year
  const shares = new Map<number, number>();
  let sum = 0;
  for (let c = 0; c < s.world.n; c++) {
    if (ctx.ownerAt(c, year) !== p.id) continue;
    const w = s.world.fertility[c] + 0.05;
    shares.set(s.world.region[c], (shares.get(s.world.region[c]) ?? 0) + w);
    sum += w;
  }
  if (sum <= 0) return;
  const lines: string[] = [];
  lines.push(`${d.pick(['Count of the households', 'Register of the people', 'The numbering of the land'])} of ${d.n(`pol:${p.id}`)}, made by order of the ${era <= 3 ? 'king' : 'government'} ${localDate(ctx, d, p, year)}.`);
  lines.push('');
  lines.push('| Province | Households | Souls |');
  lines.push('|---|---|---|');
  let hh = 0, souls = 0;
  for (const [r, w] of [...shares].sort((a, b) => b[1] - a[1])) {
    const n = Math.round((total * w) / sum * (0.93 + rng.next() * 0.1) / 10) * 10;
    const h = Math.round(n / (4.5 + rng.next()));
    hh += h;
    souls += n;
    lines.push(`| ${d.n(`reg:${r}`)} | ${fmt(h)} | ${fmt(n)} |`);
  }
  lines.push(`| **Total** | **${fmt(hh)}** | **${fmt(souls)}** |`);
  lines.push('');
  lines.push(`Men fit to bear arms: ${fmt(Number(row[6]) * (1.5 + rng.next()))}. ${d.pick(['The scribes of the provinces swore to the count before the gods.', 'Fugitives and slaves are not counted.', 'Priests and their households are exempt.'])}`);
  lines.push('', '---', '', `**Editorial note.** The simulation records ${fmt(total)} inhabitants for ${d.ed(`pol:${p.id}`)} in AY ${row[1]}; the census total differs by ${Math.round((souls / Math.max(1, total) - 1) * 100)}%, within the error typical of pre-modern counts.`);
  const m = medium(era, rng, 'soft');
  const capCity = ctx.capitalAt(p, year);
  g.add({
    sub: 'census', year, title: `Census of ${g.T.short.get(`pol:${p.id}`)}, AY ${year}`, author: author.id, polity: p.id, lang, script: ctx.scriptOf(p, year),
    medium: m.medium, cell: s.settlements[capCity].cell, settlement: capCity, about: [], body: lines.join('\n'), mentions: d.mentions,
    dateText: localDate(ctx, d, p, year), flagship: false, durable: m.durable, tau: m.tau, seat: capCity,
  });
}

// ---------------------------------------------------------------- temple and weather records
function genRecords(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const e of s.events) {
    if (e.sub !== 'famine' && e.sub !== 'eruption' && e.sub !== 'drought' && e.sub !== 'plague' && e.sub !== 'cold-period') continue;
    if (e.cell < 0) continue;
    const rng = new Rng(s.seed).fork('record', e.id);
    // the nearest literate state with a city to keep the record
    let p: Polity | null = null;
    const o = ctx.ownerAt(e.cell, e.year);
    if (o >= 0) p = s.polities[o];
    if (!p || !literate(g, p, e.year)) continue;
    if (!rng.chance(e.sub === 'famine' ? 0.35 : 0.7)) continue;
    record(g, e, p, rng);
  }
}

function record(g: Gen, e: SimEvent, p: Polity, rng: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const year = Math.min(e.end, e.year + rng.int(0, 2));
  const lang = ctx.polityLang(p, year);
  const d = g.doc(lang, year, `record:${e.id}`);
  const era = ctx.eraAt(p.id, year);
  const author = g.author(p, 'priest', year);
  const capCity = ctx.capitalAt(p, year);
  const rel = ctx.religionOf(p.id, year);
  const mov = rel >= 0 ? s.movements[rel] : s.movements[s.cultures[ctx.polityCulture(p, year)].pantheon];
  const temple = mov.deities.length ? `the temple of ${d.n(`dei:${mov.deities[0]}`)}` : `the house of the ${d.n(`mov:${mov.id}`)}`;
  const pr = g.price(capCity, GRAIN, year);
  const pr0 = g.price(capCity, GRAIN, year - 30);
  const cur = ctx.currencyAt(p.id, year);
  const curOk = cur >= 0 && s.currencies[cur].born <= year;
  const grams = curOk ? ctx.contentAt(cur, year) : 8.3;
  const unit = curOk ? d.n(`cur:${cur}`) : 'shekels of silver';
  const lines: string[] = [];
  lines.push(`${era <= 3 ? `Record kept at ${temple} in ${d.n(`set:${capCity}`)}` : `Observations recorded at ${d.n(`set:${capCity}`)}`}, ${localDate(ctx, d, p, year)}.`);
  lines.push('');
  let title = '';
  switch (e.sub) {
    case 'famine':
      title = `Temple record of the famine of AY ${e.year}`;
      lines.push(`${d.pick(['The river did not rise to its mark', 'No rain fell in the sowing month', 'Locusts came after the frost'])}. The barley ${d.pick(['withered in the ear', 'was not worth the reaping', 'failed in the upper fields'])}.${pr !== null ? ` A measure of grain cost ${fmtPrice(pr / grams)} ${unit}${pr0 !== null ? `, where a generation ago it cost ${fmtPrice(pr0 / grams)}` : ''}.` : ''} ${d.pick(['The people ate the seed-corn.', 'Families sold their children for bread.', 'The temple gave bread to the hungry from its stores.'])} (${d.n(`evt:${e.id}`)})`);
      break;
    case 'eruption':
      title = `Account of the darkened years after AY ${e.year}`;
      lines.push(`${d.pick(['The sun rose red and gave no heat', 'A haze lay over the sky for many months', 'Snow fell in the month of harvest'])}. ${d.pick(['The vines did not ripen.', 'Frost killed the young grain.', 'The cattle died in the fields.'])} ${d.pick(['The priests said the gods were angry.', 'Travellers spoke of a mountain that burned in the far country.', 'The old men had never seen its like.'])} (${d.n(`evt:${e.id}`)})`);
      break;
    case 'drought': case 'cold-period':
      title = e.sub === 'drought' ? `Record of the dry years from AY ${e.year}` : `Record of the cold years from AY ${e.year}`;
      lines.push(`${e.sub === 'drought' ? d.pick(['Year after year the rains failed', 'The wells ran dry and the river shrank to a stream', 'The herds were driven to the hills for water']) : d.pick(['The winters grew long and the summers short', 'Ice closed the rivers until the spring feasts', 'The harvest came late and thin'])}. ${pr !== null ? `Grain stood at ${fmtPrice(pr / grams)} ${unit} the measure.` : ''} (${d.n(`evt:${e.id}`)})`);
      break;
    case 'plague':
      title = `Record of the pestilence of AY ${e.year}`;
      lines.push(`${d.pick(['A sickness came by the ships', 'The fever came with the caravans', 'The sickness began in the poor quarter'])}. ${d.pick(['Those it took died within three days.', 'The dead were carried out by the cartload.', 'The markets were closed and the gates barred.'])} ${d.pick(['The priests burned incense day and night.', 'Whole streets stood empty.', 'The king fled to the hills.'])} (${d.n(`evt:${e.id}`)})`);
      break;
  }
  lines.push('', `*${d.pick(['Set down by', 'Written by', 'Recorded by'])} ${d.n(`per:${author.id}`)}.*`);
  const m = medium(era, rng, 'soft');
  g.add({
    sub: 'record', year, title, author: author.id, polity: p.id, lang, script: ctx.scriptOf(p, year), medium: m.medium, cell: s.settlements[capCity].cell,
    settlement: capCity, about: [e.id], body: lines.join('\n'), mentions: d.mentions, dateText: localDate(ctx, d, p, year), flagship: false,
    durable: m.durable, tau: m.tau, seat: capCity,
  });
}

// ---------------------------------------------------------------- coins
function genCoins(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const c of s.currencies) {
    if (c.kind !== 'coin') continue;
    const p = s.polities[c.polity];
    for (const [i, [year, content]] of c.history.entries()) {
      if (i > 0 && i % 2 === 1 && c.history.length > 6) continue;
      if (year >= 5000 || !literate(g, p, year)) continue;
      coin(g, c.id, p, year, content, i);
    }
  }
}

function coin(g: Gen, cid: number, p: Polity, year: number, content: number, issue: number): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const c = s.currencies[cid];
  const lang = ctx.polityLang(p, year);
  const d = g.doc(lang, year, `coin:${cid}:${issue}`);
  const rng = new Rng(s.seed).fork('coin', cid, issue);
  const r = ctx.rulerAt(p.id, year);
  const capCity = ctx.capitalAt(p, Math.min(year, (p.died ?? 5000) - 1));
  const legend = r ? `${ctx.s.lang.realize(s.persons[r.person].nameId, lang, year).scholarly.toUpperCase()} ${ctx.s.lang.word(lang, 'king', year).scholarly.toUpperCase()}` : ctx.s.lang.realize(p.nameId, lang, year).scholarly.toUpperCase();
  const fineness = Math.min(98, Math.round((content / c.history[0][1]) * (c.metal === 'gold' ? 96 : 92)));
  const weight = Math.round((c.metal === 'gold' ? content / 12 : content / Math.max(0.2, fineness / 100)) * 100) / 100;
  const lines = [
    `**Obverse:** ${r ? `head of ${d.n(`per:${r.person}`)}, ${d.pick(['diademed', 'bearded', 'helmeted', 'laureate', 'veiled'])}, ${d.pick(['right', 'left'])}` : `the emblem of ${d.n(`pol:${p.id}`)}`}. Legend: *${legend}*.`,
    '',
    `**Reverse:** ${d.pick(['an eagle with spread wings', 'a bull walking', 'a wheat ear', 'a ship under sail', 'a temple façade', 'the city goddess seated', 'a horseman'])}; mint mark of ${d.n(`set:${capCity}`)}.`,
    '',
    `**Metal:** ${c.metal}${c.metal === 'silver' ? `, about ${fineness}% fine` : ''}. **Weight:** ${weight} g. **Silver value:** ${content} g.`,
    '',
    '---',
    '',
    `**Editorial note.** Issue ${issue + 1} of the ${d.ed(`cur:${cid}`)}, struck around AY ${year}. ${issue > 0 ? `Compared with the first issue (${c.history[0][1]} g of silver), this coin carries ${Math.round((content / c.history[0][1]) * 100)}% of the original value${c.history[0][1] > content ? ', the result of debasement' : ''}.` : 'The first issue of the coinage.'} ${rng.chance(0.5) ? 'Known from a hoard.' : 'Many specimens survive.'}`,
  ];
  g.add({
    sub: 'coin', year, title: `${g.T.short.get(`cur:${cid}`)}, issue ${issue + 1} (c. AY ${year})`, author: null, polity: p.id, lang, script: ctx.scriptOf(p, year),
    medium: `${c.metal} coin`, cell: s.settlements[capCity].cell, settlement: capCity, about: [], body: lines.join('\n'), mentions: d.mentions,
    dateText: localDate(ctx, d, p, year), flagship: false, durable: 0.95, tau: 9000, seat: null,
  });
}

// ---------------------------------------------------------------- travelogues
function genTravelogues(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const rt of s.routes) {
    const rng = new Rng(s.seed).fork('travel', rt.year);
    if (rt.edges.length < 10 || !rng.chance(0.75)) continue;
    const year = rt.year + rng.int(5, 60);
    if (year >= 5000) continue;
    const adj = new Map<number, number[]>();
    for (const [a, b] of rt.edges) {
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a)!.push(b);
      adj.get(b)!.push(a);
    }
    const starts = [...adj.keys()].filter((x) => {
      const o = ctx.ownerAt(s.settlements[x].cell, year);
      return o >= 0 && literate(g, s.polities[o], year);
    });
    if (!starts.length) continue;
    const start = rng.pick(starts);
    const path = [start];
    const seen = new Set(path);
    for (let i = 0; i < 7; i++) {
      const next = (adj.get(path[path.length - 1]) ?? []).filter((x) => !seen.has(x) && s.settlements[x].founded <= year && (s.settlements[x].abandoned ?? 9999) > year);
      if (!next.length) break;
      const n = rng.pick(next);
      path.push(n);
      seen.add(n);
    }
    if (path.length < 4) continue;
    travelogue(g, path, year, rng);
  }
}

function travelogue(g: Gen, path: number[], year: number, rng: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const home = s.polities[ctx.ownerAt(s.settlements[path[0]].cell, year)];
  const lang = ctx.polityLang(home, year);
  const d = g.doc(lang, year, `travel:${path[0]}:${year}`);
  const author = g.author(home, 'envoy', year);
  const lines: string[] = [];
  lines.push(`${d.pick(['I, ', 'This is the account of '])}${d.n(`per:${author.id}`)}, ${d.pick(['who set out from', 'having left', 'a merchant of'])} ${d.n(`set:${path[0]}`)} ${localDate(ctx, d, home, year)}${d.pick([', to see the cities of the world.', ', on the business of my house.', ', sent by the king to the far countries.'])}`);
  for (const sid of path.slice(1)) {
    const t = s.settlements[sid];
    const o = ctx.ownerAt(t.cell, year);
    const rel = ctx.religionAt(t.cell, year);
    const pr = g.price(sid, GRAIN, year);
    const lord = o >= 0 ? ctx.rulerAt(o, year) : null;
    const pop = t.popHistory.filter(([y]) => y <= year).pop()?.[1] ?? t.peakPop;
    lines.push('');
    const size = pop > 60000 ? d.pick(['a great city, crowded beyond counting', 'a vast city with many gates']) : pop > 15000 ? d.pick(['a fair city', 'a busy town with a good market']) : d.pick(['a small town', 'a poor place of mud houses']);
    lines.push(`**${d.n(`set:${sid}`)}.** ${cap(size)}. ${o >= 0 ? `It belongs to ${d.n(`pol:${o}`)}${lord ? `, whose ruler is ${d.n(`per:${lord.person}`)}` : ''}.` : 'It obeys no king.'} ${rel >= 0 ? `The people worship after the ${d.n(`mov:${rel}`)}.` : ''} ${pr !== null ? `Grain sells for ${fmt(pr)} grains of silver the measure.` : ''} ${d.pick(['The water is good.', 'Beware the money-changers.', 'The inns are dear.', 'The people are friendly to strangers.', 'Thieves abound.', ''])}`.replace(/\s+$/, ''));
    const recent = (ctx.eventsByRef.get(`set:${sid}`) ?? []).map((i) => s.events[i]).filter((e) => e.year <= year && e.year > year - 40 && (e.sub === 'sack' || e.sub === 'siege' || e.sub === 'battle' || e.sub === 'founding-city'));
    if (recent.length) {
      const e = recent[recent.length - 1];
      lines.push(`They still speak of ${d.n(`evt:${e.id}`)}, ${year - e.year} years ago.`);
    }
  }
  lines.push('', '---', '', `**Editorial note.** The itinerary follows the trade routes of the period; rulers, faiths and grain prices named by the traveller agree with the record for AY ${year}.`);
  const era = ctx.eraAt(home.id, year);
  const m = medium(era, rng, 'soft');
  g.add({
    sub: 'travelogue', year, title: `Travels of ${g.T.short.get(`per:${author.id}`)} from ${g.T.short.get(`set:${path[0]}`)} (AY ${year})`, author: author.id, polity: home.id, lang,
    script: ctx.scriptOf(home, year), medium: era >= 4 ? 'printed book' : m.medium, cell: s.settlements[path[0]].cell, settlement: path[0], about: [], body: lines.join('\n'),
    mentions: d.mentions, dateText: localDate(ctx, d, home, year), flagship: false, durable: era >= 4 ? 0.85 : m.durable, tau: era >= 4 ? 6000 : m.tau, seat: path[0],
  });
}

// ---------------------------------------------------------------- diplomatic letters
function genDiplomaticLetters(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const e of s.events) {
    if (e.sub !== 'marriage' && !(e.sub === 'treaty' && e.data.kind === 'alliance') && e.sub !== 'war') continue;
    const rng = new Rng(s.seed).fork('dletter', e.id);
    if (e.sub === 'war' && !rng.chance(0.15)) continue;
    const pols = e.parts.filter(([r, role]) => r.startsWith('pol:') && role !== 'against').map(([r]) => s.polities[ctx.idNum(r)]);
    if (pols.length < 2) continue;
    const [A, B] = e.sub === 'war' ? [pols.find((p) => e.parts.some(([r, role]) => r === `pol:${p.id}` && role === 'defender')) ?? pols[1], pols[0]] : pols;
    if (!A || !B || !literate(g, A, e.year)) continue;
    const year = Math.max(A.born, B.born, e.year - (e.sub === 'war' ? 0 : rng.int(0, 2)));
    const ra = ctx.rulerAt(A.id, year), rb = ctx.rulerAt(B.id, year);
    if (!ra || !rb) continue;
    const pa = s.persons[ra.person];
    if (pa.born + 16 > year || pa.died < year || s.persons[rb.person].born > year) continue;
    dletter(g, e, A, B, pa.id, rb.person, year, rng);
  }
}

function dletter(g: Gen, e: SimEvent, A: Polity, B: Polity, from: number, to: number, year: number, rng: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const lang = ctx.polityLang(A, year);
  const d = g.doc(lang, year, `dletter:${e.id}`);
  const era = ctx.eraAt(A.id, year);
  const lines: string[] = [];
  const brother = era <= 1 ? 'my brother' : 'our cousin';
  if (era <= 1) lines.push(`To ${d.n(`per:${to}`)}, king of ${d.n(`pol:${B.id}`)}, ${brother}, say: thus says ${d.n(`per:${from}`)}, king of ${d.n(`pol:${A.id}`)}, your brother. With me all goes well. With you, your wives, your sons, your chariots and your land, may all go very well.`);
  else lines.push(`${d.n(`per:${from}`)}, ruler of ${d.n(`pol:${A.id}`)}, to ${d.n(`per:${to}`)}, ruler of ${d.n(`pol:${B.id}`)}, ${brother}: greeting.`);
  lines.push('');
  if (e.sub === 'marriage') {
    const sp = e.parts.filter(([, r]) => r === 'spouse').map(([x]) => x);
    lines.push(`${d.pick(['As our fathers were friends, let us be friends.', 'Let there be love between our houses.', 'I have heard of the beauty of your daughter.'])} ${sp.length === 2 ? `Let ${d.n(sp[0])} and ${d.n(sp[1])} be joined, and let the bride-price be sent with my envoy.` : 'Let a marriage join our houses.'} ${d.pick(['I send you gold, a chariot and two horses.', 'Send me much gold, for in your land gold is as dust.', 'I send you lapis and fine linen as a greeting-gift.'])}`);
  } else if (e.sub === 'treaty') {
    lines.push(`${d.pick(['The enemy grows strong on our borders.', 'Our common enemy prepares for war.', 'Let us stand together, as one house.'])} ${d.pick(['Let the oath be sworn before the gods of both lands.', 'My envoy carries the tablet of the oath; seal it and return it.', 'If he comes against you, I will come; if he comes against me, come you.'])}`);
  } else {
    lines.push(`${d.pick(['Why have your soldiers crossed into my land?', 'Your men have seized my merchants and taken their goods.', 'You have harboured my enemies.'])} ${d.pick(['Withdraw them, or the gods will judge between us.', 'Return what was taken, or I will come and take it.', 'If you will not answer, let the sword answer.'])}`);
  }
  lines.push('', '---', '', `**Editorial note.** ${e.year > year ? 'Written in the run-up to' : 'Concerning'} ${d.title(`evt:${e.id}`)}.`);
  const m = medium(era, rng, 'soft');
  const capCity = ctx.capitalAt(A, year);
  g.add({
    sub: 'letter', year, title: `Letter of ${g.T.short.get(`per:${from}`)} to ${g.T.short.get(`per:${to}`)} (AY ${year})`, author: from, polity: A.id, lang, script: ctx.scriptOf(A, year),
    medium: era <= 1 ? 'clay tablet' : m.medium, cell: s.settlements[capCity].cell, settlement: capCity, about: [e.id], body: lines.join('\n'), mentions: d.mentions,
    dateText: localDate(ctx, d, A, year), flagship: false, durable: era <= 1 ? 0.7 : m.durable, tau: era <= 1 ? 3500 : m.tau, seat: capCity,
  });
}

// ---------------------------------------------------------------- scriptures, councils, polemics
function genScriptures(g: Gen): void {
  const ctx = g.ctx;
  const s = ctx.s;
  for (const m of s.movements) {
    if (m.founder === null || m.foundEvent === null) continue;
    const e = s.events[m.foundEvent];
    const p = s.polities[ctx.idNum(e.parts.find(([r, role]) => role === 'polity' && r.startsWith('pol:'))![0])];
    const rng = new Rng(s.seed).fork('scripture', m.id);
    const year = Math.min(4999, m.born + rng.int(15, 60));
    if (!literate(g, p, Math.min(year, (p.died ?? 5000) - 1))) continue;
    sayings(g, m, p, year, rng);
    if (m.parent !== null) polemic(g, m, p, Math.min(4999, m.born + rng.int(1, 20)), rng);
  }
  for (const e of s.events) {
    if (e.sub !== 'council') continue;
    const host = s.polities[ctx.idNum(e.parts.find(([, r]) => r === 'host')![0])];
    if (!literate(g, host, e.year)) continue;
    council(g, e, host, new Rng(s.seed).fork('council', e.id));
  }
}

const SAYING_OPEN = ['The teacher said:', 'And he said:', 'It was asked of the teacher, and he answered:', 'Hear this:'];

function sayings(g: Gen, m: Movement, p: Polity, year: number, rng: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const lang = s.cultures[m.culture].lang;
  if (s.lang.info(lang).born > year) return;
  const d = g.doc(lang, year, `sayings:${m.id}`);
  const author = g.author(p, 'priest', year, m.culture);
  const [cosmos, divine, authority, ethic, world, scope] = m.tenets;
  const pool: string[] = [];
  pool.push(cosmos > 0.2 ? 'The world has a beginning and it will have an end; live as one who will be asked for an account.' : cosmos < -0.2 ? 'What rises will fall and what falls will rise; do not grieve at the turning of the wheel.' : 'Do not ask what was before the world; ask what is before you.');
  pool.push(divine > 0.3 ? 'There is one above all the gods, and the gods are its servants.' : divine < -0.3 ? 'Give each god its due, and each will give you yours.' : 'The divine is in all things as salt is in the sea.');
  pool.push(authority > 0.2 ? 'Obey those who hold the teaching, as they obeyed those before them.' : authority < -0.2 ? 'Do not believe a thing because a priest has said it. Test it as you test silver.' : 'Seek a teacher, but in the end you must walk the road yourself.');
  pool.push(ethic > 0.2 ? 'Keep your station and do your duty, and the order of the world is kept.' : ethic < -0.2 ? 'Whoever feeds the hungry stranger has fed the god.' : 'Be just in the market and gentle in the house.');
  if (world > 0.2) pool.push('Wealth is a chain of gold; the wise man goes without.');
  else if (world < -0.2) pool.push('The gods love a full granary and an open hand.');
  if (scope > 0.3) pool.push('This teaching is not for one people but for every nation; carry it to the ends of the roads.');
  else if (scope < -0.3) pool.push('This is the way of our fathers; let others keep the ways of theirs.');
  pool.push(rng.pick(['A man who lies to himself cannot hear the truth.', 'The river does not ask the stone for permission.', 'Anger is a fire that burns the one who carries it.', 'Speak little, and say what is true.', 'The lamp does not argue with the dark; it shines.', 'Do not mock the old, for you are walking toward them.']));
  const lines: string[] = [];
  lines.push(`*${d.pick(['The sayings of', 'The words of', 'What was remembered of'])} ${d.n(`per:${m.founder!}`)}, ${d.pick(['as his disciples remembered them', 'gathered by those who heard him', 'set down after his death'])}.*`);
  lines.push('');
  pool.forEach((x, i) => {
    lines.push(`${i + 1}. ${rng.chance(0.4) ? rng.pick(SAYING_OPEN) + ' ' : ''}${x}`);
  });
  lines.push('', `*Compiled by ${d.n(`per:${author.id}`)}.*`);
  lines.push('', '---', '', `**Editorial note.** The founding text of the ${d.ed(`mov:${m.id}`)}. Its teachings: ${tenetText(m.kind, m.tenets)}`);
  const era = ctx.eraAt(p.id, Math.min(year, (p.died ?? 5000) - 1));
  const med = medium(era, rng, 'soft');
  g.add({
    sub: m.kind === 'philosophy' || m.kind === 'ideology' ? 'treatise' : 'scripture', year, title: `${m.kind === 'philosophy' || m.kind === 'ideology' ? 'Teachings' : 'Sayings'} of ${g.T.short.get(`per:${m.founder!}`)}`,
    author: author.id, polity: p.id, lang, script: ctx.scriptOf(p, Math.min(year, (p.died ?? 5000) - 1)), medium: med.medium,
    cell: m.originCell, settlement: s.settlementAt[m.originCell] >= 0 ? s.settlementAt[m.originCell] : null, about: [m.foundEvent!], body: lines.join('\n'),
    mentions: d.mentions, dateText: localDate(ctx, d, p, year), flagship: false, durable: med.durable * 1.4, tau: med.tau * 2, seat: null,
  });
}

function polemic(g: Gen, m: Movement, p: Polity, year: number, rng: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const parent = s.movements[m.parent!];
  const lang = s.cultures[m.culture].lang;
  if (s.lang.info(lang).born > year || s.persons[m.founder!].died < year) return;
  const d = g.doc(lang, year, `polemic:${m.id}`);
  const axes = ['the beginning and end of the world', 'the nature of the divine', 'who may teach', 'what the good life requires', 'wealth and the body', 'whether the faith is for all peoples'];
  const diffs = m.tenets.map((t, i) => [i, t - parent.tenets[i]] as [number, number]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
  const lines: string[] = [];
  lines.push(`${d.n(`per:${m.founder!}`)} to all who still follow the ${d.n(`mov:${parent.id}`)}: ${d.pick(['you have kept the husk and thrown away the grain', 'your teachers have sold the truth for bread', 'you honour the words of the founders with your lips but not your lives'])}.`);
  lines.push('');
  for (const [i, delta] of diffs) {
    lines.push(`- On ${axes[i]}, ${delta > 0 ? 'you say too little' : 'you say too much'}: ${d.pick(['the old books themselves are against you', 'reason itself is against you', 'the founder never taught it', 'your own councils could not agree on it'])}.`);
  }
  lines.push('', `${d.pick(['Come out from among them.', 'Let whoever has ears hear.', 'We will not return until they repent.'])}`);
  lines.push('', '---', '', `**Editorial note.** A founding polemic of the ${d.ed(`mov:${m.id}`)}, which broke from the ${d.ed(`mov:${parent.id}`)} (see ${d.title(`evt:${m.foundEvent!}`)}).`);
  const era = ctx.eraAt(p.id, Math.min(year, (p.died ?? 5000) - 1));
  const med = medium(era, rng, 'soft');
  g.add({
    sub: 'treatise', year, title: `${g.T.short.get(`per:${m.founder!}`)}, Against the ${g.T.short.get(`mov:${parent.id}`)}`, author: m.founder!, polity: p.id, lang,
    script: ctx.scriptOf(p, Math.min(year, (p.died ?? 5000) - 1)), medium: med.medium, cell: m.originCell, settlement: null, about: [m.foundEvent!],
    body: lines.join('\n'), mentions: d.mentions, dateText: localDate(ctx, d, p, year), flagship: false, durable: med.durable, tau: med.tau, seat: null,
  });
}

function council(g: Gen, e: SimEvent, host: Polity, rng: Rng): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const year = e.year;
  const lang = ctx.polityLang(host, year);
  const d = g.doc(lang, year, `council:${e.id}`);
  const mov = e.parts.find(([, r]) => r === 'movement')![0];
  const dissent = e.parts.find(([, r]) => r === 'dissenters')?.[0];
  const author = g.author(host, 'priest', year);
  const canons = [
    `That the teaching of the ${d.n(mov)} is one, and that those who divide it are cut off.`,
    'That the elders of each city shall be appointed by the elders of the chief city, and by no other.',
    `That the books read in the assemblies are those read in the time of the founder, and no others.`,
    'That no one may be received who has not been taught for a full year.',
    rng.pick(['That the feast of the founder shall be kept on one day in all the cities.', 'That the poor shall be fed at every assembly.', 'That none shall take interest from a brother in the faith.']),
  ];
  const lines = [
    `Acts of the assembly of elders of the ${d.n(mov)}, gathered at ${d.n(`set:${ctx.capitalAt(host, year)}`)} ${localDate(ctx, d, host, year)}${dissent ? `, in the matter of the teachers of ${d.n(dissent)}` : ''}.`,
    '',
    'The assembly decreed:',
    '',
    ...canons.map((c, i) => `${ordinal(i + 1)}. ${c}`),
    '',
    `${dissent ? `The delegates of ${d.n(dissent)} ${d.pick(['left the assembly before the vote', 'refused to sign', 'walked out in anger'])}.` : ''} *Signed for the assembly by ${d.n(`per:${author.id}`)}.*`,
    '', '---', '', `**Editorial note.** The council failed to hold the movement together; see ${d.title(`evt:${e.id}`)} and the schism that followed.`,
  ];
  const era = ctx.eraAt(host.id, year);
  const med = medium(era, rng, 'soft');
  const capCity = ctx.capitalAt(host, year);
  g.add({
    sub: 'scripture', year, title: `Acts of the ${g.T.short.get(`evt:${e.id}`)}`, author: author.id, polity: host.id, lang, script: ctx.scriptOf(host, year),
    medium: med.medium, cell: s.settlements[capCity].cell, settlement: capCity, about: [e.id], body: lines.join('\n'), mentions: d.mentions,
    dateText: localDate(ctx, d, host, year), flagship: false, durable: med.durable * 1.3, tau: med.tau * 1.5, seat: capCity,
  });
}

export { money, goodName };
export type { Doc };
