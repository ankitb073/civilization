// Editorial naming: unique page titles, regnal numbers, epithets, event names.
import type { Ctx } from './context.ts';
import { roman, ordinalWord, cap } from './context.ts';
import type { Polity, Person, SimEvent, GovType } from '../sim/state.ts';
import { TECHS } from '../sim/tech.ts';
import { GOODS } from '../sim/economy.ts';
import type { EntityKind } from '../export/contract.ts';
import { KIND_PREFIX } from '../export/contract.ts';

export interface Titles {
  title: Map<string, string>; // ref -> unique page title
  short: Map<string, string>; // ref -> editorial display name
  aliases: Map<string, string[]>;
  regnal: Map<number, string>; // person -> " II"
  epithet: Map<number, string>;
  plagueNames: Map<number, string>;
  pageRefs: Set<string>; // entities that get a page
}

const GOV_TITLE: Record<GovType, (x: string) => string> = {
  chiefdom: (x) => `${x} Chiefdom`,
  'city-state': (x) => `City-State of ${x}`,
  kingdom: (x) => `Kingdom of ${x}`,
  empire: (x) => `${x} Empire`,
  theocracy: (x) => `Theocracy of ${x}`,
  'merchant-republic': (x) => `Merchant Republic of ${x}`,
  'feudal-kingdom': (x) => `Kingdom of ${x}`,
  horde: (x) => `${x} Horde`,
  'absolute-monarchy': (x) => `Kingdom of ${x}`,
  'constitutional-monarchy': (x) => `Kingdom of ${x}`,
  republic: (x) => `Republic of ${x}`,
  federation: (x) => `${x} Federation`,
  'one-party-state': (x) => `People's State of ${x}`,
  democracy: (x) => `Commonwealth of ${x}`,
  colony: (x) => `Colony of ${x}`,
};

const PLAGUE_ADJ = ['Grey', 'Black', 'Red', 'White', 'Yellow', 'Sweating', 'Spotted', 'Burning', 'Weeping', 'Shaking', 'Blue', 'Pale', 'Bloody', 'Silent', 'Wasting', 'Scarlet', 'Marsh', 'River', 'Harbour', 'Long'];
const PLAGUE_NOUN = ['Fever', 'Death', 'Pox', 'Cough', 'Flux', 'Sickness', 'Plague', 'Pestilence', 'Ague', 'Blight'];

const MINOR_EVENTS = new Set(['expansion', 'alliance-lapse', 'house-dissolution', 'election', 'weight-standard']);

export function isPageEvent(e: SimEvent): boolean {
  return !MINOR_EVENTS.has(e.sub);
}

/** The government form a polity held longest. */
export function mainGov(p: Polity): GovType {
  const end = p.died ?? 5000;
  const dur = new Map<GovType, number>();
  p.govs.forEach(([y, g], i) => {
    const next = i + 1 < p.govs.length ? p.govs[i + 1][0] : end;
    dur.set(g, (dur.get(g) ?? 0) + Math.max(1, next - y));
  });
  let best = p.govs[0][1], bd = -1;
  for (const [g, d] of dur) if (d > bd) { bd = d; best = g; }
  return best;
}

export function editorialName(ctx: Ctx, ref: string): string {
  const s = ctx.s;
  const k = ref.slice(0, 3);
  const id = ctx.idNum(ref);
  switch (k) {
    case 'pol': {
      const p = s.polities[id];
      const y = Math.min(p.died ?? 5000, p.born + 60);
      return ctx.name(p.nameId, ctx.polityLang(p, y), Math.max(y, langBorn(ctx, ctx.polityLang(p, y))));
    }
    case 'per': {
      const p = s.persons[id];
      const lang = s.cultures[p.culture].lang;
      return ctx.name(p.nameId, lang, Math.max(langBorn(ctx, lang), Math.min(p.died, p.born + 30)));
    }
    case 'set': {
      const t = s.settlements[id];
      const y = t.abandoned !== null ? t.abandoned - 1 : 5000;
      const cu = ctx.cultureAt(t.cell, y);
      const lang = cu >= 0 ? s.cultures[cu].lang : s.cultures[t.culture].lang;
      return ctx.name(t.nameId, lang, Math.max(y, langBorn(ctx, lang)));
    }
    case 'reg': {
      const cont = ctx.continents.get(id);
      if (cont) {
        const cu = ctx.cultureAt(cont.labelCell, 5000);
        const lang = cu >= 0 ? s.cultures[cu].lang : 0;
        return ctx.name(cont.nameId, lang, 5000);
      }
      const cell = s.world.regionLabelCell[id];
      const cu = ctx.cultureAt(cell, 5000);
      const lang = cu >= 0 ? s.cultures[cu].lang : 0;
      return ctx.name(s.regionNames[id], lang, 5000);
    }
    case 'riv': {
      const rv = s.world.rivers[id];
      const cu = ctx.cultureAt(rv.cells[Math.floor(rv.cells.length / 2)], 5000);
      const lang = cu >= 0 ? s.cultures[cu].lang : 0;
      return ctx.name(s.riverNames[id], lang, 5000);
    }
    case 'cul': {
      const c = s.cultures[id];
      const y = Math.min(c.died ?? 5000, Math.max(c.born, 0) + 100);
      return ctx.name(c.nameId, c.lang, Math.max(y, langBorn(ctx, c.lang)));
    }
    case 'lan': {
      const info = s.lang.info(id);
      const y = Math.min(info.died ?? 5000, info.born + 100);
      return ctx.name(info.endonym, id, y);
    }
    case 'scr': {
      const sc = s.scripts[id];
      const lang = s.cultures[sc.culture].lang;
      return ctx.name(sc.nameId, lang, sc.born);
    }
    case 'mov': {
      const m = s.movements[id];
      const lang = s.cultures[m.culture].lang;
      return ctx.name(m.nameId, lang, Math.max(m.born, langBorn(ctx, lang)));
    }
    case 'dei': {
      const d = s.deities[id];
      const lang = s.cultures[d.culture].lang;
      return ctx.name(d.nameId, lang, Math.max(langBorn(ctx, lang), Math.min(d.born + 300, 1000)));
    }
    case 'cur': {
      const c = s.currencies[id];
      const lang = ctx.polityLang(c.polity, c.born);
      return ctx.name(c.nameId, lang, c.born);
    }
    case 'hou': {
      const h = s.houses[id];
      const cu = s.persons[h.founder].culture;
      return ctx.name(h.nameId, s.cultures[cu].lang, h.born);
    }
    case 'cli': {
      const a = s.anomalies[id];
      if (a.nameId !== null) {
        const cu = ctx.cultureAt(a.volcanoCell, a.start);
        const lang = cu >= 0 ? s.cultures[cu].lang : 0;
        return ctx.name(a.nameId, lang, Math.max(a.start, langBorn(ctx, lang)));
      }
      return '';
    }
    case 'tec':
      return TECHS[id].name;
    default:
      return ref;
  }
}

function langBorn(ctx: Ctx, lang: number): number {
  return ctx.s.lang.info(lang).born;
}

export function buildTitles(ctx: Ctx): Titles {
  const s = ctx.s;
  const T: Titles = { title: new Map(), short: new Map(), aliases: new Map(), regnal: new Map(), epithet: new Map(), plagueNames: new Map(), pageRefs: new Set() };
  const want = new Map<string, string>(); // ref -> preferred title
  const span = (a: number, b: number | null) => `AY ${a}–${b ?? 5000}`;

  // --- page-worthy entities
  ctx.ensureContinents();
  for (const id of ctx.continents.keys()) T.pageRefs.add(`reg:${id}`);
  for (const e of s.events) {
    if (e.sub !== 'first-contact') continue;
    for (const lm of (e.data.landmasses as number[] | undefined) ?? []) {
      const ref = `reg:${1000 + lm}`;
      if (ctx.continents.has(1000 + lm) && !e.parts.some(([r]) => r === ref)) e.parts.push([ref, 'continent']);
    }
  }
  for (const p of s.polities) T.pageRefs.add(`pol:${p.id}`);
  for (const t of s.settlements) T.pageRefs.add(`set:${t.id}`);
  for (let r = 0; r < s.world.regionCount; r++) T.pageRefs.add(`reg:${r}`);
  for (let r = 0; r < s.world.rivers.length; r++) T.pageRefs.add(`riv:${r}`);
  for (const c of s.cultures) T.pageRefs.add(`cul:${c.id}`);
  for (const l of s.lang.languages()) T.pageRefs.add(`lan:${l.id}`);
  for (const sc of s.scripts) T.pageRefs.add(`scr:${sc.id}`);
  for (const m of s.movements) T.pageRefs.add(`mov:${m.id}`);
  for (const d of s.deities) T.pageRefs.add(`dei:${d.id}`);
  for (const c of s.currencies) T.pageRefs.add(`cur:${c.id}`);
  for (const h of s.houses) T.pageRefs.add(`hou:${h.id}`);
  for (const a of s.anomalies) T.pageRefs.add(`cli:${a.id}`);
  for (const t of TECHS) T.pageRefs.add(`tec:${t.id}`);
  for (const e of s.events) if (isPageEvent(e)) T.pageRefs.add(`evt:${e.id}`);
  for (const p of s.persons) if (p.roles.length > 0 || ctx.eventsByRef.has(`per:${p.id}`)) T.pageRefs.add(`per:${p.id}`);

  // --- regnal numbers and epithets
  for (const [pid, reigns] of ctx.reigns) {
    const byName = new Map<number, number[]>();
    for (const r of reigns) {
      const person = s.persons[r.person];
      if (r.role !== 'ruler') continue;
      let a = byName.get(person.nameId);
      if (!a) byName.set(person.nameId, (a = []));
      if (!a.includes(person.id)) a.push(person.id);
    }
    for (const ids of byName.values()) if (ids.length > 1) ids.forEach((id, i) => T.regnal.set(id, ' ' + roman(i + 1)));
    void pid;
  }
  assignEpithets(ctx, T);

  // --- names for entities (events last: their titles use the other names)
  const ordered = [...T.pageRefs].sort((a, b) => (a.startsWith('evt:') ? 1 : 0) - (b.startsWith('evt:') ? 1 : 0));
  for (const ref of ordered) {
    const k = ref.slice(0, 3);
    const id = ctx.idNum(ref);
    let short = '';
    let title = '';
    switch (k) {
      case 'pol': {
        const p = s.polities[id];
        short = editorialName(ctx, ref);
        title = GOV_TITLE[mainGov(p)](short);
        break;
      }
      case 'per': {
        const p = s.persons[id];
        short = editorialName(ctx, ref) + (T.regnal.get(id) ?? '');
        const ep = T.epithet.get(id);
        title = short + (ep ? ` ${ep}` : '');
        break;
      }
      case 'set': short = editorialName(ctx, ref); title = short; break;
      case 'reg': {
        short = editorialName(ctx, ref);
        const cont = ctx.continents.get(id);
        title = cont && cont.cells < 300 ? `${short} Islands` : short;
        if (cont && cont.cells < 300) short = title;
        break;
      }
      case 'riv': short = editorialName(ctx, ref); title = `${short} River`; break;
      case 'cul': short = editorialName(ctx, ref); title = `${short} (people)`; break;
      case 'lan': short = editorialName(ctx, ref); title = s.lang.info(id).parent === null ? `Proto-${short}` : `${short} language`; break;
      case 'scr': short = editorialName(ctx, ref); title = `${short} script`; break;
      case 'mov': {
        const m = s.movements[id];
        short = editorialName(ctx, ref);
        title = m.kind === 'pantheon' ? `${short} religion` : m.kind === 'philosophy' ? `${short} school` : m.kind === 'ideology' ? `${short}ism` : m.kind === 'sect' || m.kind === 'reform' ? `${short} movement` : m.kind === 'cult' ? `Cult of ${short}` : `${short} faith`;
        if (m.kind === 'ideology') short = `${short}ism`;
        break;
      }
      case 'dei': short = editorialName(ctx, ref); title = short; break;
      case 'cur': short = editorialName(ctx, ref); title = `${short} (currency)`; break;
      case 'hou': {
        const h = s.houses[id];
        short = editorialName(ctx, ref);
        title = h.kind === 'bank' ? `${short} Bank` : h.kind === 'company' ? `${short} Company` : h.kind === 'corporation' ? `${short} Corporation` : `House of ${short}`;
        short = title;
        break;
      }
      case 'cli': {
        const a = s.anomalies[id];
        const nm = editorialName(ctx, ref);
        if (a.kind === 'eruption') title = `Volcanic Winter of Mount ${nm} (AY ${a.start})`;
        else if (a.kind === 'drought') {
          const mid = a.cells[Math.floor(a.cells.length / 2)];
          const reg = mid !== undefined && s.world.region[mid] >= 0 ? T.short.get(`reg:${s.world.region[mid]}`) : undefined;
          title = `The Great Drought${reg ? ` of ${reg}` : ''}, AY ${a.start}–${a.end}`;
        }
        else if (a.kind === 'cold') title = `The Cold Spell of AY ${a.start}–${a.end}`;
        else title = 'The Industrial Warming';
        short = title;
        break;
      }
      case 'tec': short = TECHS[id].name; title = short; break;
      case 'evt': {
        const e = s.events[id];
        title = eventTitle(ctx, T, e);
        short = title;
        break;
      }
    }
    T.short.set(ref, short);
    want.set(ref, title);
  }
  // --- ordinal wars (needs short names of polities)
  numberWars(ctx, T, want);
  // --- uniqueness
  const groups = new Map<string, string[]>();
  for (const [ref, t] of want) {
    let a = groups.get(t.toLowerCase());
    if (!a) groups.set(t.toLowerCase(), (a = []));
    a.push(ref);
  }
  for (const [, refs] of groups) {
    if (refs.length === 1) { T.title.set(refs[0], want.get(refs[0])!); continue; }
    for (const ref of refs) {
      const base = want.get(ref)!;
      const id = ctx.idNum(ref);
      let q = '';
      switch (ref.slice(0, 3)) {
        case 'pol': { const p = s.polities[id]; q = span(p.born, p.died); break; }
        case 'per': { const p = s.persons[id]; q = `AY ${p.born}–${p.died}`; break; }
        case 'set': { const t = s.settlements[id]; q = `${T.short.get(`reg:${s.world.region[t.cell]}`) ?? ''}, founded AY ${t.founded}`; break; }
        case 'evt': q = `AY ${s.events[id].year}`; break;
        case 'reg': q = ctx.continents.has(id) ? 'continent' : 'region'; break;
        case 'cul': q = `AY ${s.cultures[id].born}`; break;
        case 'lan': q = `AY ${s.lang.info(id).born}`; break;
        case 'mov': q = `AY ${s.movements[id].born}`; break;
        case 'dei': { const d = s.deities[id]; q = `${T.short.get(`cul:${d.culture}`)} ${d.sex === 'f' ? 'goddess' : 'god'} of ${domainPhrase(d.domain)}`; break; }
        case 'cur': q = `AY ${s.currencies[id].born}`; break;
        case 'hou': q = `AY ${s.houses[id].born}`; break;
        default: q = ref;
      }
      T.title.set(ref, `${base} (${q})`);
    }
  }
  // final collision sweep: append id
  const seen = new Map<string, string>();
  for (const [ref, t] of T.title) {
    const key = t.toLowerCase();
    if (seen.has(key)) T.title.set(ref, `${t} [${ref}]`);
    else seen.set(key, ref);
  }
  return T;
}

function polShort(T: Titles, id: number | string): string {
  const ref = typeof id === 'number' ? `pol:${id}` : id;
  return T.short.get(ref) ?? ref;
}

function setShort(T: Titles, id: string | undefined): string {
  return id ? T.short.get(id) ?? '' : '';
}

const TECH_NAMES = TECHS.map((t) => t.name.replace(/^The /, 'the '));

export function eventTitle(ctx: Ctx, T: Titles, e: SimEvent): string {
  const s = ctx.s;
  const first = (role: string) => ctx.partsOf(e, role)[0];
  const P = (role: string) => polShort(T, first(role) ?? 'pol:?');
  switch (e.sub) {
    case 'war': {
      const goal = e.data.goal as string;
      const a = P('attacker'), d = P('defender');
      const reg = first('target') ? T.short.get(first('target')) ?? '' : '';
      if (goal === 'independence') return `${a} War of Independence`;
      if (goal === 'civil') return `${d} Civil War`;
      if (goal === 'succession') return `War of the ${d} Succession`;
      if (goal === 'invasion') return `${a} Invasion of ${d}`;
      if (goal === 'holy') return `Holy War of ${a} against ${d}`;
      if (goal === 'trade' && reg) return `${reg} Trade War`;
      if (goal === 'colonial') return `${a} Colonial War${reg ? ` in ${reg}` : ''}`;
      return `${a}–${d} War`;
    }
    case 'battle': {
      const near = first('near');
      const place = near ? setShort(T, near) : T.short.get(`reg:${e.data.region}`) ?? '';
      return `Battle of ${place}`;
    }
    case 'siege': return `Siege of ${setShort(T, first('settlement'))}`;
    case 'sack': return `Sack of ${setShort(T, first('settlement'))}`;
    case 'treaty': {
      const kind = e.data.kind as string;
      if (kind === 'alliance') {
        const ps = ctx.partsOf(e, 'party');
        return `Alliance of ${polShort(T, ps[0])} and ${polShort(T, ps[1])}`;
      }
      const site = first('signed at');
      return site ? `Treaty of ${setShort(T, site)}` : `Peace of AY ${e.year}`;
    }
    case 'conquest': return `Conquest of ${P('vanquished')}`;
    case 'suppression': return `Suppression of the ${P('vanquished')} Revolt`;
    case 'collapse': return `Collapse of the ${polShort(T, first('collapsed'))} State`;
    case 'founding': return `Founding of ${polShort(T, first('polity'))}`;
    case 'successor-state': return `Rise of ${polShort(T, first('polity'))}`;
    case 'revolt': return `Revolt of ${polShort(T, first('polity'))}`;
    case 'civil-war': return `Secession of ${polShort(T, first('polity'))}`;
    case 'extinction': return `End of ${polShort(T, first('polity'))}`;
    case 'annexation': return `Annexation of ${polShort(T, first('annexed'))}`;
    case 'repudiation': return `${polShort(T, first('vassal'))} Repudiates ${polShort(T, first('overlord'))}`;
    case 'capital-move': return `Removal of the ${polShort(T, first('polity'))} Capital to ${setShort(T, first('to'))}`;
    case 'succession': return `Accession of ${T.short.get(first('successor')) ?? ''}`;
    case 'usurpation': return `Usurpation of ${T.short.get(first('successor')) ?? ''}`;
    case 'reform': return `${cap(String(e.data.to).replace(/-/g, ' '))} Reform in ${P('polity')}`;
    case 'revolution': return `${P('polity')} Revolution of AY ${e.year}`;
    case 'famine': return `Famine of AY ${e.year} in ${T.short.get(first('region')) ?? ''}`;
    case 'plague': return T.plagueNames.get(e.id) ?? `Plague of AY ${e.year}`;
    case 'eruption': return `Eruption of Mount ${T.short.get(first('anomaly')) ? editorialName(ctx, first('anomaly')) : ''} (AY ${e.year})`;
    case 'drought': return `Onset of the Great Drought${e.cell >= 0 && T.short.get(`reg:${s.world.region[e.cell]}`) ? ` in ${T.short.get(`reg:${s.world.region[e.cell]}`)}` : ''} (AY ${e.year})`;
    case 'cold-period': return `Onset of the Cold Spell (AY ${e.year})`;
    case 'warming': return `Onset of the Industrial Warming`;
    case 'migration': return `Migration of the ${T.short.get(first('migrants')) ?? ''} into ${T.short.get(first('destination')) ?? ''}`;
    case 'founding-city': return `Founding of ${setShort(T, first('settlement'))}`;
    case 'abandonment': return `Abandonment of ${setShort(T, first('settlement'))}`;
    case 'invention': return `Invention of ${TECH_NAMES[e.data.tech as number].replace(/^./, (c) => c.toLowerCase())} in ${P('polity')}`;
    case 'ethnogenesis': return `Emergence of the ${T.short.get(first('culture')) ?? ''}`;
    case 'acculturation': return `Acculturation of the ${P('polity')} Court`;
    case 'script-invention': return `Invention of the ${T.short.get(first('script')) ?? ''} Script`;
    case 'script-adoption': return `Adoption of the ${T.short.get(first('script')) ?? ''} Script in ${P('polity')}`;
    case 'movement-founding': {
      const k = String(e.data.kind);
      const word = k === 'philosophy' ? 'School' : k === 'ideology' ? 'Movement' : k === 'cult' ? 'Cult' : k === 'sect' ? 'Sect' : k === 'reform' ? 'Reform' : 'Faith';
      return `Founding of the ${T.short.get(first('movement')) ?? ''} ${word}`;
    }
    case 'excavation': return `Excavation at ${setShort(T, first('site'))} (AY ${e.year})`;
    case 'election': return `${P('polity')} Election of AY ${e.year}`;
    case 'schism': return `The ${T.short.get(first('movement')) ?? ''} Schism`;
    case 'council': return `Council of ${setShort(T, `set:${ctx.capitalAt(ctx.s.polities[ctx.idNum(first('host'))], e.year)}`)}`;
    case 'conversion': return `Conversion of ${P('polity')} to ${T.short.get(first('adopted')) ?? ''}`;
    case 'persecution': return `Persecution of the ${T.short.get(first('persecuted')) ?? ''} in ${P('persecutor')}`;
    case 'marriage': {
      const sp = ctx.partsOf(e, 'spouse');
      return `Marriage of ${T.short.get(sp[0]) ?? ''} and ${T.short.get(sp[1]) ?? ''}`;
    }
    case 'coinage': return `First Coinage of ${P('issuer')}`;
    case 'paper-money': return `First Banknotes of ${P('issuer')}`;
    case 'currency-reform': return `${P('issuer')} Currency Reform of AY ${e.year}`;
    case 'debasement': return `Debasement of the ${T.short.get(first('currency')) ?? ''} (AY ${e.year})`;
    case 'hyperinflation': return `${P('issuer')} Hyperinflation of AY ${e.year}`;
    case 'house-founding': return `Founding of the ${T.short.get(first('house')) ?? ''}`;
    case 'bankruptcy': return `Failure of the ${T.short.get(first('house')) ?? ''}`;
    case 'default': return `${P('debtor')} Default of AY ${e.year}`;
    case 'panic': return `Panic of AY ${e.year}`;
    case 'trade-collapse': return `The Great Contraction of AY ${e.year}`;
    case 'first-contact': {
      const lms = (e.data.landmasses as number[] | undefined) ?? [];
      const names = lms.map((lm) => T.short.get(`reg:${1000 + lm}`)).filter(Boolean);
      return names.length === 2 ? `First Contact between ${names[0]} and ${names[1]}` : `First Contact at ${setShort(T, ctx.partsOf(e, 'port')[1])}`;
    }
    case 'colonization': return `Founding of the Colony of ${setShort(T, first('colony'))}`;
    case 'colonial-claim': return `${P('claimant')} Claim against ${P('target')}`;
    default: return `${cap(e.sub.replace(/-/g, ' '))} of AY ${e.year}`;
  }
}

function numberWars(ctx: Ctx, T: Titles, want: Map<string, string>): void {
  const s = ctx.s;
  // plague names
  const rng = ctx.rng.fork('plague-names');
  const used = new Set<string>();
  for (const e of s.events) {
    if (e.sub !== 'plague') continue;
    let nm = '';
    for (let i = 0; i < 50; i++) {
      nm = `The ${rng.pick(PLAGUE_ADJ)} ${rng.pick(PLAGUE_NOUN)}`;
      if (!used.has(nm)) break;
    }
    used.add(nm);
    T.plagueNames.set(e.id, nm);
    want.set(`evt:${e.id}`, `${nm} (AY ${e.year})`);
    T.short.set(`evt:${e.id}`, nm);
  }
  // ordinal pair wars, ordinal battles at the same place
  const byTitle = new Map<string, string[]>();
  for (const e of s.events) {
    if (e.sub !== 'war' && e.sub !== 'battle' && e.sub !== 'treaty' && e.sub !== 'siege' && e.sub !== 'sack' && e.sub !== 'famine') continue;
    const ref = `evt:${e.id}`;
    const t = want.get(ref);
    if (!t) continue;
    let a = byTitle.get(t);
    if (!a) byTitle.set(t, (a = []));
    a.push(ref);
  }
  for (const [t, refs] of byTitle) {
    if (refs.length < 2) continue;
    const perYear = new Map<number, number>();
    for (const ref of refs) { const y = s.events[ctx.idNum(ref)].year; perYear.set(y, (perYear.get(y) ?? 0) + 1); }
    const seenYear = new Map<number, number>();
    refs.forEach((ref, i) => {
      const e = s.events[ctx.idNum(ref)];
      let nt: string;
      if (e.sub === 'war' || ((e.sub === 'battle' || e.sub === 'siege' || e.sub === 'sack') && refs.length <= 12)) nt = `${cap(ordinalWord(i + 1))} ${t}`;
      else if ((perYear.get(e.year) ?? 0) > 1) {
        // several at the same place in one year: number them within the year
        const k = (seenYear.get(e.year) ?? 0) + 1;
        seenYear.set(e.year, k);
        nt = `${cap(ordinalWord(k))} ${t} (AY ${e.year})`;
      } else nt = `${t} (AY ${e.year})`;
      want.set(ref, nt);
      T.short.set(ref, nt);
    });
  }

  void KIND_PREFIX;
  void GOODS;
}

function assignEpithets(ctx: Ctx, T: Titles): void {
  const s = ctx.s;
  const rng = ctx.rng.fork('epithets');
  for (const [pid, reigns] of ctx.reigns) {
    for (const r of reigns) {
      if (r.role !== 'ruler') continue;
      const person = s.persons[r.person];
      if (T.epithet.has(person.id)) continue;
      const evs = (ctx.eventsByRef.get(`pol:${pid}`) ?? []).map((i) => s.events[i]).filter((e) => e.year >= r.start && e.year <= r.end);
      let won = 0, lost = 0, conq = 0, built = 0, conv = 0;
      for (const e of evs) {
        if (e.sub === 'treaty' || e.sub === 'conquest') {
          const role = e.parts.find(([x]) => x === `pol:${pid}`)?.[1];
          if (role === 'victor') won++;
          if (role === 'vanquished') lost++;
          if (e.sub === 'conquest' && role === 'victor') conq++;
        }
        if (e.sub === 'founding-city') built++;
        if (e.sub === 'conversion') conv++;
      }
      const len = r.end - r.start;
      const p = s.polities[pid];
      let ep: string | null = null;
      if (person.roles.some((x) => x.role === 'usurper')) ep = rng.chance(0.5) ? 'the Usurper' : null;
      else if (conq >= 2 || won >= 4) ep = rng.pick(['the Great', 'the Conqueror', 'the Victorious']);
      else if (lost >= 3 && won === 0) ep = rng.pick(['the Unlucky', 'the Unfortunate', 'the Ill-Starred']);
      else if (conv > 0) ep = rng.pick(['the Pious', 'the Devout', 'the Convert']);
      else if (person.deathCause === 'battle') ep = rng.chance(0.5) ? 'the Brave' : null;
      else if (p.died !== null && p.died <= r.end + 1 && p.died >= r.end - 1 && reigns.length > 2) ep = 'the Last';
      else if (len >= 40) ep = rng.chance(0.5) ? 'the Old' : null;
      else if (len <= 1) ep = rng.chance(0.4) ? 'the Brief' : null;
      else if (built >= 2) ep = 'the Builder';
      else if (rng.chance(0.07)) ep = rng.pick(['the Fair', 'the Wise', 'the Cruel', 'the Stout', 'the Lame', 'the Silent', 'the Generous', 'the Just', 'the Red', 'the Black']);
      if (ep) T.epithet.set(person.id, ep);
    }
  }
}

/** "the underworld", "storms", "war"… for "god of …" phrases. */
export function domainPhrase(domain: string): string {
  const the = new Set(['underworld', 'sky', 'sea', 'earth', 'sun', 'moon', 'harvest', 'dawn', 'night']);
  const plural: Record<string, string> = { river: 'rivers', storm: 'storms', grain: 'grain' };
  return the.has(domain) ? `the ${domain}` : plural[domain] ?? domain;
}

export function kindOfRef(ref: string): EntityKind {
  const p = ref.slice(0, 3);
  const m: Record<string, EntityKind> = { pol: 'polity', per: 'person', set: 'settlement', reg: 'region', riv: 'river', cul: 'culture', lan: 'language', scr: 'script', mov: 'movement', dei: 'deity', cur: 'currency', hou: 'house', tec: 'tech', cli: 'climate', evt: 'event', art: 'artifact' };
  return m[p];
}

export type { Person };
