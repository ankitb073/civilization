// Treaties: the text of every peace and alliance, in formulae that change with the era.
// Terms are rendered from the structured treaty data, so text and territory log always agree.
import type { Gen } from './gen.ts';
import { money, fmt, techAt } from './gen.ts';
import type { Doc } from '../archive/doc.ts';
import { localDate } from '../archive/doc.ts';
import type { SimEvent, Polity } from '../sim/state.ts';
import type { Term } from '../sim/war.ts';
import { cap, ordinal } from '../archive/context.ts';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export function genTreaties(g: Gen): void {
  const s = g.ctx.s;
  for (const e of s.events) {
    if (e.sub !== 'treaty') continue;
    const parties = e.parts.filter(([r, role]) => r.startsWith('pol:') && role !== 'against').map(([r]) => s.polities[g.ctx.idNum(r)]);
    if (parties.length < 2) continue;
    const victorRef = e.parts.find(([, role]) => role === 'victor')?.[0];
    const drafter = victorRef ? s.polities[g.ctx.idNum(victorRef)] : parties[0];
    if (g.ctx.scriptOf(drafter, e.year) < 0) continue; // an illiterate court keeps no written treaty
    treaty(g, e, drafter, parties);
  }
}

function treaty(g: Gen, e: SimEvent, drafter: Polity, parties: Polity[]): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const year = e.year;
  const lang = ctx.polityLang(drafter, year);
  const d = g.doc(lang, year, `treaty:${e.id}`);
  const era = ctx.eraAt(drafter.id, year);
  const kind = e.data.kind as string;
  const terms = (e.data.terms as Term[]) ?? [];
  const site = e.parts.find(([, r]) => r === 'signed at')?.[0];
  const author = g.author(drafter, era >= 4 ? 'envoy' : 'scribe', year);
  const A = parties[0];
  const B = parties.find((p) => p.id !== A.id)!;
  const ruler = (p: Polity) => ctx.rulerAt(p.id, year);
  const rulerLink = (p: Polity) => {
    const r = ruler(p);
    return r ? d.n(`per:${r.person}`) : `${govWord(ctx.govAt(p, year))} ${d.n(`pol:${p.id}`)}`;
  };
  /** Is the polity's sovereign a woman (for pronouns and kinship terms)? */
  const fem = (p: Polity) => {
    const r = ruler(p);
    return !!r && s.persons[r.person].sex === 'f';
  };
  const title = (p: Polity) => {
    const r = ruler(p);
    return titleOf(ctx.govAt(p, year), era, r ? s.persons[r.person].sex === 'f' : false);
  };
  const date = localDate(ctx, d, drafter, year, { day: era >= 2, key: `evt:${e.id}` });
  const war = typeof e.data.war === 'number' ? e.data.war as number : null;
  const lines: string[] = [];
  const art = (n: number) => (era <= 1 ? `§${n}` : era <= 3 ? `Article ${n}.` : `Article ${ROMAN[n - 1] ?? n}.`);
  let n = 0;
  const pantheonOf = (p: Polity) => {
    const rel = ctx.religionOf(p.id, year);
    const m = rel >= 0 ? s.movements[rel] : null;
    return m;
  };
  const gods = (p: Polity, k: number) => {
    const m = pantheonOf(p);
    if (!m || m.deities.length === 0) {
      const pan = s.movements[s.cultures[p.culture].pantheon];
      return pan.deities.slice(0, k).map((x) => d.n(`dei:${x}`));
    }
    return m.deities.slice(0, k).map((x) => d.n(`dei:${x}`));
  };
  const faith = (p: Polity) => {
    const m = pantheonOf(p);
    return m ? d.n(`mov:${m.id}`) : 'the gods';
  };

  // ---------------------------------------------------------------- preamble
  if (kind === 'alliance') {
    if (era <= 1) {
      const sibling = fem(B) ? 'sister' : 'brother';
      lines.push(`Thus says ${rulerLink(A)}, ${title(A)} of ${d.n(`pol:${A.id}`)}, to ${rulerLink(B)}, ${title(B)} of ${d.n(`pol:${B.id}`)}, ${fem(A) ? 'her' : 'his'} ${sibling}:`);
      lines.push('');
      lines.push(`Between ${d.n(`pol:${A.id}`)} and ${d.n(`pol:${B.id}`)} there shall be good peace and good brotherhood for ever. ${d.pick(['The enemy of the one is the enemy of the other; the friend of the one is the friend of the other.', `If an enemy comes against the land of my ${sibling}, I will come to ${fem(B) ? 'her' : 'his'} aid with my ${techAt(A, 'chariot', year) ? 'chariots' : 'spearmen'} and my foot.`, 'As the two rivers flow into one sea, so shall our two houses be one.'])}`);
    } else if (era <= 3) {
      lines.push(`In the name of ${faith(A)}. These are the terms of friendship sworn between ${d.n(`pol:${A.id}`)}, under ${rulerLink(A)}, and ${d.n(`pol:${B.id}`)}, under ${rulerLink(B)}.`);
    } else {
      lines.push(`${cap(govWord(ctx.govAt(A, year)))} ${d.n(`pol:${A.id}`)} and ${govWord(ctx.govAt(B, year))} ${d.n(`pol:${B.id}`)}, ${d.pick(['desiring to secure their common frontiers', 'mindful of the dangers that surround them', 'wishing to strengthen the bonds of friendship between their peoples'])}, have agreed as follows:`);
    }
    const against = typeof e.data.against === 'number' ? e.data.against as number : null;
    lines.push('');
    lines.push(`${art(++n)} ${era <= 1 ? 'If' : 'Should'} ${against !== null ? d.n(`pol:${against}`) : 'any power'} ${era <= 1 ? 'march against either land, the other shall march with all his strength.' : 'attack either party, the other shall take up arms in its defence within the season.'}`);
    lines.push('');
    lines.push(`${art(++n)} Neither shall make peace ${against !== null ? `with ${d.n(`pol:${against}`)}` : 'with the common enemy'} without the other.`);
    lines.push('');
    lines.push(`${art(++n)} ${d.pick(['Fugitives from the one land shall be returned by the other.', 'Merchants of either land shall travel in the other under its protection.', 'Envoys of either court shall be received with honour and fed at the king\'s table.'])}`);
    lines.push('');
    lines.push(`${art(++n)} This compact shall stand for ${era <= 1 ? 'thirty years' : 'thirty years from this day'}, and may be renewed.`);
  } else {
    const victor = e.parts.find(([, r]) => r === 'victor')?.[0];
    const vanq = e.parts.find(([, r]) => r === 'vanquished')?.[0];
    const W = victor ? s.polities[ctx.idNum(victor)] : A;
    const L = vanq ? s.polities[ctx.idNum(vanq)] : B;
    if (era <= 1) {
      const tw = title(W);
      lines.push(`Thus says ${rulerLink(W)}, ${tw.startsWith('great') ? `${tw}, ${tw.replace('great ', '')}` : tw} of ${d.n(`pol:${W.id}`)}, beloved of ${gods(W, 1)[0] ?? 'the gods'}:`);
      lines.push('');
      if (victor) lines.push(`${d.pick(['The gods of', 'The storm-god of', 'The lord of'])} ${d.n(`pol:${W.id}`)} went before me, and ${d.n(`pol:${L.id}`)} ${d.pick(['bowed down', 'sued for peace', 'sent tribute to my camp', 'came to my feet'])}. ${war !== null ? `The war which ${rulerLink(L)} ${d.pick(['began', 'stirred up', `brought upon ${fem(L) ? 'her' : 'his'} own land`])} is ended.` : ''}`);
      else lines.push(`${rulerLink(A)} and ${rulerLink(B)} have made peace, and set their words upon this tablet.`);
    } else if (era <= 3) {
      lines.push(`In the name of ${faith(W)}${pantheonOf(L)?.id !== pantheonOf(W)?.id ? ` and of ${faith(L)}` : ''}. ${victor ? `Peace is granted by ${rulerLink(W)}, ${title(W)} of ${d.n(`pol:${W.id}`)}, to ${rulerLink(L)} of ${d.n(`pol:${L.id}`)}, on these conditions.` : `Peace is made between ${d.n(`pol:${A.id}`)} and ${d.n(`pol:${B.id}`)} on these conditions.`}`);
    } else if (era === 4) {
      lines.push(`Treaty of Peace and Amity between ${govWord(ctx.govAt(A, year))} ${d.n(`pol:${A.id}`)} and ${govWord(ctx.govAt(B, year))} ${d.n(`pol:${B.id}`)}.`);
      lines.push('');
      lines.push(`${cap(art(++n))} There shall be a firm, sincere and perpetual peace between ${d.n(`pol:${A.id}`)} and ${d.n(`pol:${B.id}`)}, and between their subjects, and all hostilities shall cease from the day of signature.`);
    } else {
      lines.push(`The High Contracting Parties, ${govWord(ctx.govAt(A, year))} ${d.n(`pol:${A.id}`)} and ${govWord(ctx.govAt(B, year))} ${d.n(`pol:${B.id}`)}, ${d.pick(['resolved to bring the state of war between them to an end', 'desiring to restore normal relations', 'determined to settle the questions arising from the late conflict'])}, have agreed as follows:`);
      lines.push('');
      lines.push(`${art(++n)} The state of war between the Parties is terminated as from the entry into force of this Treaty.`);
    }
    for (const t of terms) {
      const clause = termClause(g, d, t, era, year, W, L);
      if (clause) {
        lines.push('');
        lines.push(`${art(++n)} ${clause}`);
      }
    }
  }

  // ---------------------------------------------------------------- oaths, curses, signatures
  lines.push('');
  if (era <= 1) {
    const witnesses = [...new Set([...gods(A, 3), ...gods(B, 3)])];
    const sameGods = pantheonOf(A)?.id === pantheonOf(B)?.id;
    lines.push(`The gods of the oath are witnesses: ${witnesses.join(', ')}, ${sameGods ? `the gods whom ${d.n(`pol:${A.id}`)} and ${d.n(`pol:${B.id}`)} alike revere` : `and the thousand gods of ${d.n(`pol:${A.id}`)} and of ${d.n(`pol:${B.id}`)}`}.`);
    lines.push('');
    lines.push(`Whoever changes the words of this tablet, ${d.pick(['may the gods of the oath destroy him, his house, his land and his seed', 'may his name be taken from the land and his seed from the earth', 'may the river refuse him water and the field refuse him grain'])}. Whoever keeps them, may the gods protect him in the house of his father.`);
    lines.push('');
    lines.push(`Written by ${d.n(`per:${author.id}`)}, the scribe, ${date}${site ? `, at ${d.n(site)}` : ''}.`);
  } else if (era <= 3) {
    lines.push(`Sworn ${site ? `at ${d.n(site)} ` : ''}${date}, before ${faith(A)}${pantheonOf(B)?.id !== pantheonOf(A)?.id ? ` and ${faith(B)}` : ''}. ${d.pick(['Each party keeps a copy sealed with the seal of the other.', 'Copies are deposited in the chief temples of both realms.', 'Let it be read aloud in the markets of both lands.'])}`);
    lines.push('');
    lines.push(`Witnessed and written by ${d.n(`per:${author.id}`)}.`);
  } else {
    lines.push(`${era >= 5 ? `This Treaty shall be ratified, and shall enter into force on the exchange of instruments of ratification.` : 'The ratifications shall be exchanged within three months.'}`);
    lines.push('');
    lines.push(`Done ${site ? `at ${d.n(site)}` : ''}, ${date}, in two copies.`);
    lines.push('');
    const sig = [A, B].map((p) => {
      const r = ruler(p);
      return r ? `For ${d.n(`pol:${p.id}`)}: ${d.n(`per:${r.person}`)}` : `For ${d.n(`pol:${p.id}`)}`;
    });
    lines.push(sig.join('  \n'));
    lines.push('');
    lines.push(`Drafted by ${d.n(`per:${author.id}`)}.`);
  }

  const medium = era <= 1 ? d.pick(['clay tablet', 'clay tablet', 'silver tablet']) : era <= 3 ? d.pick(['parchment', 'papyrus roll', 'bronze tablet']) : era === 4 ? 'parchment, with seals' : 'typescript, bound';
  const durable = medium.includes('clay') || medium.includes('silver') || medium.includes('bronze') ? 0.75 : medium === 'typescript, bound' ? 0.9 : 0.4;
  const tau = durable >= 0.75 ? 4000 : durable >= 0.9 ? 8000 : 1400;
  const tt = kind === 'alliance' ? `Treaty of alliance between ${g.T.short.get(`pol:${A.id}`)} and ${g.T.short.get(`pol:${B.id}`)}` : `Text of the ${g.T.short.get(`evt:${e.id}`)}`;
  const editorial = editorialNote(g, d, e, war);
  g.add({
    sub: 'treaty', year, title: tt, author: author.id, polity: drafter.id, lang, script: ctx.scriptOf(drafter, year), medium,
    cell: site ? s.settlements[ctx.idNum(site)].cell : s.settlements[ctx.capitalAt(drafter, year)].cell,
    settlement: site ? ctx.idNum(site) : ctx.capitalAt(drafter, year), about: war !== null ? [e.id, war] : [e.id],
    body: lines.join('\n') + '\n' + editorial, mentions: d.mentions, dateText: date, flagship: false, durable, tau,
    seat: ctx.capitalAt(drafter, year),
  });
}

function termClause(g: Gen, d: Doc, t: Term, era: number, year: number, W: Polity, L: Polity): string | null {
  const ctx = g.ctx;
  const s = ctx.s;
  const P = (id?: number) => (id === undefined ? '' : d.n(`pol:${id}`));
  switch (t.kind) {
    case 'cede': {
      const towns = (t.settlements ?? []).filter((x) => s.settlements[x].founded <= year).map((x) => d.n(`set:${x}`));
      const regions = (t.regions ?? []).map((r) => d.n(`reg:${r}`));
      const river = t.river !== undefined ? d.n(`riv:${t.river}`) : null;
      const where = `${regions.length ? `the land of ${listJoin(regions)}` : 'the border districts'}${towns.length ? `, with the towns of ${listJoin(towns)}` : ''}`;
      if (era <= 1) return `${cap(where)}, its fields and its people, ${P(t.from)} gives to ${P(t.to)}.${river ? ` The river ${river} shall be the boundary.` : ''} ${d.pick(['Boundary stones shall be set up.', 'No man of the one land shall plough beyond the stones.', ''])}`.trim();
      if (era <= 3) return `${P(t.from)} cedes to ${P(t.to)} ${where}, ${plural(t.cells?.length ?? 0, 'district')} in all${river ? `, the river ${river} to be the frontier` : ''}.`;
      return `${P(t.from)} renounces in favour of ${P(t.to)} all rights and title to ${where} (${plural(t.cells?.length ?? 0, 'district')}), as delimited in the annexed map${river ? `, the median line of the ${river} forming the frontier` : ''}.`;
    }
    case 'indemnity':
      if (era <= 1) return `${P(t.from)} shall pay ${money(g, d, t.amount!, t.from!, year)} to ${P(t.to)}, ${d.pick(['weighed by the stone of the palace', 'brought in the month of the harvest', 'before the next new year'])}.`;
      if (era <= 3) return `As satisfaction for the costs of the war, ${P(t.from)} shall pay ${money(g, d, t.amount!, t.from!, year)} to ${P(t.to)}.`;
      return `${P(t.from)} shall pay to ${P(t.to)} by way of ${era >= 5 ? 'reparation' : 'indemnity'} the sum of ${money(g, d, t.amount!, t.from!, year)}${era >= 5 ? ', in ten annual instalments' : ''}.`;
    case 'tribute':
      if (era <= 1) return `Each year ${P(t.from)} shall bring ${money(g, d, t.amount!, t.from!, year)} as tribute to the palace of ${P(t.to)}, for ${t.years} years. If he withholds it, he has broken the oath.`;
      return `${P(t.from)} shall render to ${P(t.to)} a yearly tribute of ${money(g, d, t.amount!, t.from!, year)} for ${t.years} years.`;
    case 'vassal':
      if (era <= 1) return `${P(t.from)} shall be a servant of ${P(t.to)}. The friend of my friend shall be his friend, the enemy of my enemy his enemy.`;
      if (era <= 3) return `${P(t.from)} acknowledges the overlordship of ${P(t.to)} and shall send its levies when summoned.`;
      return `${P(t.from)} places its foreign relations under the protection of ${P(t.to)}.`;
    case 'truce':
      if (era <= 1) return `For ${t.years} years no man of the one land shall take up arms against the other.`;
      if (era <= 3) return `There shall be a truce of ${t.years} years, and raiders of either side shall be handed over for judgement.`;
      return `The Parties undertake to refrain from any act of force against one another for a period of ${t.years} years.`;
    case 'marriage': {
      const [a, b] = t.persons ?? [];
      if (a === undefined || b === undefined) return null;
      const pa = s.persons[a], pb = s.persons[b];
      const father = (p: typeof pa) => (p.father !== null ? `, child of ${d.n(`per:${p.father}`)}` : '');
      return `To bind the two houses, ${d.n(`per:${a}`)}${father(pa)} shall be given in marriage to ${d.n(`per:${b}`)}${father(pb)}.`;
    }
    case 'trade':
      if (era <= 1) return `The merchants of ${P(t.to)} shall pass through the land of ${P(t.from)} unhindered; no toll shall be taken of them and no man shall seize their goods.`;
      if (era <= 3) return `The merchants of ${P(t.to)} shall trade in the markets of ${P(t.from)} free of all tolls.`;
      return `${P(t.from)} shall accord to the goods and shipping of ${P(t.to)} treatment no less favourable than that accorded to any other nation.`;
    case 'conversion': {
      const m = t.movement !== undefined ? d.n(`mov:${t.movement}`) : 'the true faith';
      return `${cap(era <= 1 ? 'in' : 'Throughout')} the land of ${P(t.from)} the worship of ${m} shall be permitted and its shrines protected; ${era <= 3 ? 'its ruler shall make offering at its altar' : 'its adherents shall suffer no disability'}.`;
    }
    case 'independence':
      return era <= 3 ? `${P(t.from)} recognises ${P(t.to)} as a free land, owing it neither tribute nor service.` : `${P(t.from)} recognises the full sovereignty and independence of ${P(t.to)}.`;
    case 'annexation':
      return era <= 1 ? `The land of ${P(t.from)} is joined to ${P(t.to)} for ever; its people shall serve the ${(() => { const r = t.to !== undefined ? ctx.rulerAt(t.to, year) : null; return r && s.persons[r.person].sex === 'f' ? 'queen' : 'king'; })()} of ${P(t.to)}.` : `${P(t.from)} is incorporated into ${P(t.to)} and ceases to exist as a separate realm.`;
    case 'partition':
      return `The realm shall be divided: ${P(t.to)} shall hold the lands it now holds, and ${P(t.from)} the rest.`;
    case 'status-quo':
      return era <= 3 ? 'Each shall keep what he held before the war.' : 'The frontiers shall remain as they were before the outbreak of hostilities.';
    case 'amnesty':
      return 'Those who took up arms shall be pardoned, save the leaders of the rebellion.';
    default:
      return null;
  }
}

function editorialNote(g: Gen, d: Doc, e: SimEvent, war: number | null): string {
  const lines = ['', '---', '', '**Editorial note.**'];
  const parts: string[] = [];
  if (war !== null) parts.push(`This instrument ended the ${d.title(`evt:${war}`)}.`);
  parts.push(`For the circumstances see ${d.title(`evt:${e.id}`)}.`);
  const terms = (e.data.terms as Term[]) ?? [];
  const cede = terms.find((t) => t.kind === 'cede');
  if (cede) parts.push(`The cession of ${plural(cede.cells?.length ?? 0, 'district')} is confirmed by the frontier as it appears on the atlas from AY ${e.year}.`);
  lines.push(parts.join(' '));
  void fmt;
  void ordinal;
  return lines.join('\n');
}

export function govWord(gov: string): string {
  switch (gov) {
    case 'republic': case 'democracy': case 'federation': return 'the Republic of';
    case 'one-party-state': return 'the People\'s State of';
    case 'merchant-republic': return 'the Most Serene Republic of';
    case 'empire': return 'the Empire of';
    case 'theocracy': return 'the Holy See of';
    case 'horde': return 'the Horde of';
    case 'city-state': case 'chiefdom': return 'the city of';
    default: return 'the Kingdom of';
  }
}

function titleOf(gov: string, era: number, female = false): string {
  const t = (m: string, f: string) => (female ? f : m);
  if (gov === 'empire') return era <= 1 ? t('great king', 'great queen') : t('emperor', 'empress');
  if (gov === 'horde') return t('khan', 'khatun');
  if (gov === 'city-state' || gov === 'chiefdom') return era <= 1 ? t('lord', 'lady') : t('prince', 'princess');
  if (gov === 'theocracy') return t('high priest', 'high priestess');
  if (gov === 'republic' || gov === 'democracy' || gov === 'federation') return 'president';
  if (gov === 'one-party-state') return 'chairman';
  if (gov === 'merchant-republic') return 'doge';
  return t('king', 'queen');
}

export function plural(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}

export function listJoin(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

export { titleOf };
