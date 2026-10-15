// Entity pages: infobox, narrative, names through time, series, related documents.
import type { Ctx } from './context.ts';
import { cap, fmtNum, ordinal } from './context.ts';
import type { Titles } from './naming.ts';
import { isPageEvent, mainGov, kindOfRef, domainPhrase } from './naming.ts';
import type { PageJson, EntityKind } from '../export/contract.ts';
import type { Artifact } from '../artifacts/gen.ts';
import { TECHS } from '../sim/tech.ts';
import { GOODS } from '../sim/economy.ts';
import { BIOMES, RES, RESOURCE_NAMES } from '../world/biomes.ts';
import type { SimEvent, Polity } from '../sim/state.ts';
import type { Term } from '../sim/war.ts';
import type { NameId, LangId } from '../lang/index.ts';
import { describeEvent } from './events.ts';

export interface PageBuild {
  pages: Map<string, PageJson>;
}

export function L(T: Titles, ref: string, text?: string): string {
  if (!T.pageRefs.has(ref)) return text ?? T.short.get(ref) ?? ref;
  return `[[${ref}|${text ?? T.short.get(ref) ?? ref}]]`;
}

function LT(T: Titles, ref: string): string {
  return L(T, ref, T.title.get(ref) ?? T.short.get(ref));
}

function blank(ref: string, T: Titles, sub: string, t0: number, t1: number, cell: number): PageJson {
  return {
    id: ref, kind: kindOfRef(ref) as EntityKind, sub, title: T.title.get(ref) ?? ref, t0, t1, summary: '', infobox: [], body: '',
    links: [], backlinks: [], labels: {}, cell,
  };
}

function yr(y: number | null | undefined): string {
  if (y === null || y === undefined) return '—';
  return y < 0 ? `${-y} before AY 0` : `AY ${y}`;
}

function span(a: number, b: number | null): string {
  return `${yr(a)} – ${b === null || b >= 5000 ? 'present' : yr(b)}`;
}

/** Names of an entity through time: native lineage at several dates, plus exonyms. */
function nameHistory(ctx: Ctx, nameId: NameId, nativeLangAt: (y: number) => LangId, t0: number, t1: number, exo: LangId[]): PageJson['names'] {
  const s = ctx.s;
  const out: NonNullable<PageJson['names']> = [];
  const seen = new Set<string>();
  const start = Math.max(t0, s.lang.nameOrigin(nameId).year);
  const end = Math.min(t1, 5000);
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const y = Math.round(start + ((end - start) * i) / steps);
    const lang = nativeLangAt(y);
    if (lang < 0 || s.lang.info(lang).born > y) continue;
    const r = s.lang.realize(nameId, lang, y);
    const key = `${lang}|${r.conventional}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ year: y, lang: ctx.s.lang ? langLabel(ctx, lang) : '', form: r.conventional, scholarly: r.scholarly });
  }
  for (const lang of exo) {
    const info = s.lang.info(lang);
    const y = Math.min(end, info.died ?? 5000, Math.max(start, info.born + 50));
    if (y < info.born) continue;
    const r = s.lang.realize(nameId, lang, y);
    const key = `${lang}|${r.conventional}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ year: y, lang: langLabel(ctx, lang), form: r.conventional, scholarly: r.scholarly });
  }
  return out.sort((a, b) => a.year - b.year);
}

let titlesRef: Titles | null = null;
export function langLabel(ctx: Ctx, lang: LangId): string {
  return titlesRef?.short.get(`lan:${lang}`) ?? `language ${lang}`;
}

function eventsOf(ctx: Ctx, ref: string): SimEvent[] {
  return (ctx.eventsByRef.get(ref) ?? []).map((i) => ctx.s.events[i]).filter(isPageEvent).sort((a, b) => a.year - b.year || a.id - b.id);
}

function eventList(ctx: Ctx, T: Titles, evs: SimEvent[], limit = 40): string {
  const top = evs.length > limit ? evs.slice().sort((a, b) => b.sig - a.sig).slice(0, limit).sort((a, b) => a.year - b.year || a.id - b.id) : evs;
  const lines = top.map((e) => `- **${yr(e.year)}**: ${LT(T, `evt:${e.id}`)}`);
  if (evs.length > limit) lines.push(`- *…and ${evs.length - limit} lesser events.*`);
  return lines.join('\n');
}

function docList(T: Titles, arts: Artifact[], limit = 30): string {
  const a = arts.slice().sort((x, y) => x.year - y.year).slice(0, limit);
  return a.map((x) => `- ${L(T, `art:${x.id}`, x.title)} (${yr(x.year)})`).join('\n') + (arts.length > limit ? `\n- *…and ${arts.length - limit} more.*` : '');
}

export function buildPages(ctx: Ctx, T: Titles, artifacts: Artifact[]): Map<string, PageJson> {
  titlesRef = T;
  const s = ctx.s;
  const pages = new Map<string, PageJson>();
  const artsBy = new Map<string, Artifact[]>();
  for (const a of artifacts) {
    if (a.status !== 'extant') continue;
    const add = (ref: string) => {
      let x = artsBy.get(ref);
      if (!x) artsBy.set(ref, (x = []));
      x.push(a);
    };
    if (a.polity !== null) add(`pol:${a.polity}`);
    if (a.author !== null) add(`per:${a.author}`);
    for (const e of a.about) add(`evt:${e}`);
  }
  const exoLangs = (cell: number): LangId[] => {
    // languages of neighbouring peoples at a few dates
    const set = new Set<LangId>();
    for (const y of [1000, 2500, 4000, 5000]) {
      for (const k of s.world.neighbors[cell]) {
        const cu = ctx.cultureAt(k, y);
        if (cu >= 0) set.add(s.cultures[cu].lang);
      }
    }
    set.add(ctx.editorialLang);
    return [...set].slice(0, 5);
  };

  // ---------------------------------------------------------------- polities
  for (const p of s.polities) {
    const ref = `pol:${p.id}`;
    const pg = blank(ref, T, mainGov(p), p.born, p.died ?? 5000, s.settlements[p.capital].cell);
    const stats = ctx.polityStats.get(p.id) ?? [];
    const peakCells = Math.max(0, ...stats.map((r) => r[2] as number));
    const peakPop = Math.max(0, ...stats.map((r) => r[3] as number));
    const capitals = p.capitals.map(([y, c]) => `${L(T, `set:${c}`)} (from ${yr(y)})`);
    const govs = p.govs.map(([y, g]) => `${g.replace(/-/g, ' ')} (${yr(y)})`);
    const religions = [...new Set(stats.map((r) => r[11] as number).filter((x) => x >= 0))].slice(0, 6);
    const currencies = [...new Set(stats.map((r) => r[12] as number).filter((x) => x >= 0))].slice(0, 6);
    pg.summary = `${T.short.get(ref)} was ${article(govLabel(mainGov(p)))} ${govLabel(mainGov(p))} of the ${T.short.get(`cul:${p.culture}`)} people, ${span(p.born, p.died)}. At its height it held ${plural(peakCells, 'district')} and about ${fmtNum(peakPop)} people.`;
    pg.infobox = [
      ['Period', span(p.born, p.died)],
      ['Founded', LT(T, `evt:${p.foundEvent}`)],
      ...(p.endEvent !== null ? [['Ended', LT(T, `evt:${p.endEvent}`)] as [string, string]] : []),
      ['Capital', capitals.join('; ')],
      ['Government', govs.join('; ')],
      ['People', L(T, `cul:${p.culture}`)],
      ['Language', L(T, `lan:${s.cultures[p.culture].lang}`)],
      ['Religion', religions.map((r) => L(T, `mov:${r}`)).join(', ') || '—'],
      ['Currency', currencies.map((c) => L(T, `cur:${c}`)).join(', ') || '—'],
      ...(p.predecessor !== null ? [['Preceded by', LT(T, `pol:${p.predecessor}`)] as [string, string]] : []),
      ...(p.successors.length ? [['Succeeded by', p.successors.map((x) => LT(T, `pol:${x}`)).join(', ')] as [string, string]] : []),
      ['Peak extent', `${peakCells} districts`],
      ['Peak population', fmtNum(peakPop)],
      ['Succession', p.successionLaw.replace(/-/g, ' ')],
    ];
    const reigns = ctx.reigns.get(p.id) ?? [];
    const evs = eventsOf(ctx, ref);
    const body: string[] = [];
    body.push(`## History`);
    body.push('');
    body.push(polityNarrative(ctx, T, p, evs));
    body.push('');
    body.push('## Chronology');
    body.push('');
    body.push(eventList(ctx, T, evs.filter((e) => e.sub !== 'battle' && e.sub !== 'succession'), 45));
    if (reigns.length) {
      body.push('');
      body.push(`## ${reigns[0].role === 'ruler' ? 'Rulers' : 'Heads of state'}`);
      body.push('');
      body.push('| Ruler | From | To | End |');
      body.push('|---|---|---|---|');
      for (const r of reigns.slice(0, 120)) {
        const person = s.persons[r.person];
        const how = person.died <= r.end ? (person.deathCause === 'natural' ? 'died' : person.deathCause) : r.end >= (p.died ?? 5000) ? 'end of state' : 'succeeded';
        body.push(`| ${LT(T, `per:${r.person}`)} | ${r.start} | ${r.end} | ${how} |`);
      }
    }
    const docs = artsBy.get(ref) ?? [];
    if (docs.length) {
      body.push('');
      body.push('## Documents of the state');
      body.push('');
      body.push(docList(T, docs));
    }
    pg.body = body.join('\n');
    pg.series = [
      { label: 'Territory', unit: 'districts', points: stats.map((r) => [r[1] as number, r[2] as number]) },
      { label: 'Population', unit: 'people', points: stats.map((r) => [r[1] as number, r[3] as number]) },
      { label: 'Army', unit: 'soldiers', points: stats.map((r) => [r[1] as number, r[6] as number]) },
      { label: 'Stability', unit: '0–1', points: stats.map((r) => [r[1] as number, r[7] as number]) },
    ].map((x) => ({ ...x, points: thin(x.points as [number, number][], 120) }));
    pg.names = nameHistory(ctx, p.nameId, () => s.cultures[p.culture].lang, p.born, p.died ?? 5000, exoLangs(s.settlements[p.capital].cell));
    pages.set(ref, pg);
  }

  // ---------------------------------------------------------------- persons
  for (const ref of T.pageRefs) {
    if (!ref.startsWith('per:')) continue;
    const p = s.persons[ctx.idNum(ref)];
    const pg = blank(ref, T, p.roles[0]?.role ?? 'person', p.born, Math.min(p.died, 5000), p.polity !== null ? s.settlements[s.polities[p.polity].capital].cell : -1);
    const roles = p.roles.map((r) => `${r.role}${r.polity !== null ? ` of ${L(T, `pol:${r.polity}`)}` : ''} (${r.start}${r.end !== null && r.end !== r.start ? `–${r.end}` : ''})${r.ref ? `: ${L(T, r.ref)}` : ''}`);
    const lang = s.cultures[p.culture].lang;
    const meaning = s.lang.nameMeaning(p.nameId);
    const roleText = (r: (typeof p.roles)[number]) => {
      const where = r.polity !== null ? ` of ${T.short.get(`pol:${r.polity}`) ?? ''}` : '';
      const what = r.role === 'ruler' ? (p.sex === 'f' ? 'queen' : 'king') : r.role === 'merchant' && r.ref ? `head of the ${T.short.get(r.ref) ?? 'house'}` : r.role;
      const when = r.end !== null && r.end !== r.start ? ` from AY ${r.start} to ${r.end}` : ` in AY ${r.start}`;
      return `${article(what)} ${what}${r.role === 'merchant' ? '' : where}${when}`;
    };
    pg.summary = `${T.short.get(ref)} (${yr(p.born)} – ${p.died >= 5000 ? 'living' : yr(p.died)}) was ${p.roles.length ? joinList([...new Set(p.roles.map(roleText))].slice(0, 2)) : 'a person of note'}.`;
    const kids = p.children.filter((c) => T.pageRefs.has(`per:${c}`));
    pg.infobox = [
      ['Born', yr(p.born)],
      ['Died', p.died >= 5000 ? 'living' : `${yr(p.died)} (${p.deathCause})${p.deathEvent !== null && T.pageRefs.has(`evt:${p.deathEvent}`) ? `, ${LT(T, `evt:${p.deathEvent}`)}` : ''}`],
      ['People', L(T, `cul:${p.culture}`)],
      ...(meaning ? [['Name means', `“${meaning}”`] as [string, string]] : []),
      ...(p.father !== null && T.pageRefs.has(`per:${p.father}`) ? [['Father', L(T, `per:${p.father}`)] as [string, string]] : []),
      ...(p.mother !== null && T.pageRefs.has(`per:${p.mother}`) ? [['Mother', L(T, `per:${p.mother}`)] as [string, string]] : []),
      ...(p.spouses.filter((x) => T.pageRefs.has(`per:${x}`)).length ? [['Spouse', p.spouses.filter((x) => T.pageRefs.has(`per:${x}`)).map((x) => L(T, `per:${x}`)).join(', ')] as [string, string]] : []),
      ...(kids.length ? [['Children', kids.map((x) => L(T, `per:${x}`)).join(', ')] as [string, string]] : []),
      ...(p.dynasty !== null ? [['House', `${T.short.get(`per:${s.dynasties[p.dynasty].founder}`) ?? ''} dynasty`] as [string, string]] : []),
      ['Roles', roles.join('; ') || '—'],
    ];
    const evs = eventsOf(ctx, ref);
    const body: string[] = [];
    body.push('## Life');
    body.push('');
    body.push(personNarrative(ctx, T, p.id, evs));
    if (evs.length) {
      body.push('');
      body.push('## Events');
      body.push('');
      body.push(eventList(ctx, T, evs, 40));
    }
    const docs = artsBy.get(ref) ?? [];
    if (docs.length) {
      body.push('');
      body.push('## Writings and monuments');
      body.push('');
      body.push(docList(T, docs));
    }
    pg.body = body.join('\n');
    pg.names = nameHistory(ctx, p.nameId, () => lang, p.born, Math.min(p.died, 5000), [ctx.editorialLang]);
    pages.set(ref, pg);
  }

  // ---------------------------------------------------------------- settlements
  for (const t of s.settlements) {
    const ref = `set:${t.id}`;
    const pg = blank(ref, T, t.port ? 'port' : 'city', t.founded, t.abandoned ?? 5000, t.cell);
    const owners = compressOwners(ctx.ownerHistory(t.cell).filter(([y]) => y <= (t.abandoned ?? 5000)), t.founded);
    const region = s.world.region[t.cell];
    const meaning = s.lang.nameMeaning(t.nameId);
    pg.summary = `${T.short.get(ref)} was ${t.abandoned === null ? 'a city' : 'an ancient city'} in ${T.short.get(`reg:${region}`)}, founded ${yr(t.founded)}${t.abandoned !== null ? ` and abandoned ${yr(t.abandoned)}` : ''}. At its peak it had about ${fmtNum(t.peakPop)} inhabitants.`;
    pg.infobox = [
      ['Founded', `${yr(t.founded)}, ${LT(T, `evt:${t.foundEvent}`)}`],
      ...(t.endEvent !== null ? [['Abandoned', LT(T, `evt:${t.endEvent}`)] as [string, string]] : []),
      ['Region', L(T, `reg:${region}`)],
      ...(ctx.continentOfCell(t.cell) !== null ? [['Continent', L(T, `reg:${ctx.continentOfCell(t.cell)}`)] as [string, string]] : []),
      ['Founders', L(T, `cul:${t.culture}`)],
      ...(meaning ? [['Name means', `“${meaning}”`] as [string, string]] : []),
      ['Peak population', fmtNum(t.peakPop)],
      ['Port', t.port ? 'yes' : 'no'],
      ['Sacked', t.sacks.length ? t.sacks.map((e) => L(T, `evt:${e}`, `${yr(s.events[e].year)}`)).join(', ') : 'never'],
    ];
    const body: string[] = [];
    body.push('## Masters of the city');
    body.push('');
    body.push(owners.length ? owners.map(([a, b, o]) => `- ${yr(a)} – ${b >= 5000 ? 'present' : yr(b)}: ${o >= 0 ? LT(T, `pol:${o}`) : '*no state*'}`).join('\n') : '- *never part of a state*');
    const evs = eventsOf(ctx, ref);
    if (evs.length) {
      body.push('');
      body.push('## Events');
      body.push('');
      body.push(eventList(ctx, T, evs, 40));
    }
    const houses = s.houses.filter((h) => h.settlement === t.id);
    if (houses.length) {
      body.push('');
      body.push('## Merchant houses');
      body.push('');
      body.push(houses.slice(0, 40).map((h) => `- ${L(T, `hou:${h.id}`)} (${yr(h.born)} – ${yr(h.died)})`).join('\n'));
    }
    pg.body = body.join('\n');
    pg.series = [{ label: 'Population', unit: 'people', points: t.popHistory.map(([y, v]) => [y, v] as [number, number]) }];
    const langAt = (y: number) => {
      const cu = ctx.cultureAt(t.cell, y);
      return cu >= 0 ? s.cultures[cu].lang : s.cultures[t.culture].lang;
    };
    pg.names = nameHistory(ctx, t.nameId, langAt, t.founded, t.abandoned ?? 5000, exoLangs(t.cell));
    pages.set(ref, pg);
  }

  // ---------------------------------------------------------------- regions & rivers
  for (let r = 0; r < s.world.regionCount; r++) {
    const ref = `reg:${r}`;
    const cell = s.world.regionLabelCell[r];
    const pg = blank(ref, T, 'region', -3000, 5000, cell);
    const cells: number[] = [];
    for (let i = 0; i < s.world.n; i++) if (s.world.region[i] === r) cells.push(i);
    const biomes = new Map<number, number>();
    let res = 0;
    for (const c of cells) { biomes.set(s.world.biome[c], (biomes.get(s.world.biome[c]) ?? 0) + 1); res |= s.world.resources[c]; }
    const mainBiome = [...biomes].sort((a, b) => b[1] - a[1])[0];
    const resources = RESOURCE_NAMES.filter((k) => res & RES[k]);
    pg.summary = `${T.short.get(ref)} is a region of ${cells.length} districts, mostly ${BIOMES[mainBiome[0]].name.toLowerCase()}.`;
    pg.infobox = [['Districts', String(cells.length)], ['Landscape', BIOMES[mainBiome[0]].name], ['Resources', resources.join(', ') || '—'], ['Area', `${fmtNum(cells.length * s.world.cellArea)} km²`],
      ...(ctx.continentOfCell(cell) !== null ? [['Continent', L(T, `reg:${ctx.continentOfCell(cell)}`)] as [string, string]] : [])];
    const owners = compressOwners(ctx.ownerHistory(cell), -3000);
    const body: string[] = ['## Masters of the region', '', owners.map(([a, b, o]) => `- ${yr(Math.max(a, 0))} – ${b >= 5000 ? 'present' : yr(b)}: ${o >= 0 ? LT(T, `pol:${o}`) : '*no state*'}`).join('\n')];
    const evs = eventsOf(ctx, ref);
    if (evs.length) body.push('', '## Events', '', eventList(ctx, T, evs, 40));
    const towns = s.settlements.filter((t) => s.world.region[t.cell] === r);
    if (towns.length) body.push('', '## Cities', '', towns.map((t) => `- ${L(T, `set:${t.id}`)} (founded ${yr(t.founded)})`).join('\n'));
    pg.body = body.join('\n');
    pg.names = nameHistory(ctx, s.regionNames[r], (y) => { const cu = ctx.cultureAt(cell, y); return cu >= 0 ? s.cultures[cu].lang : 0; }, 0, 5000, exoLangs(cell));
    pages.set(ref, pg);
  }
  // ---------------------------------------------------------------- continents (archive-level regions 1000+)
  for (const [cid, cont] of ctx.continents) {
    const ref = `reg:${cid}`;
    const pg = blank(ref, T, 'continent', -3000, 5000, cont.labelCell);
    const lm = cont.lm;
    const regions = [...new Set(Array.from({ length: s.world.n }, (_, c) => c).filter((c) => s.world.landmass[c] === lm && s.world.region[c] >= 0).map((c) => s.world.region[c]))];
    const peak = new Map<number, number>();
    for (const [pid, rows] of ctx.polityStats) for (const row of rows) peak.set(pid, Math.max(peak.get(pid) ?? 0, row[2] as number));
    const states = s.polities.filter((p) => p.capitals.some(([, c]) => s.world.landmass[s.settlements[c].cell] === lm)).sort((a, b) => (peak.get(b.id) ?? 0) - (peak.get(a.id) ?? 0) || a.id - b.id).slice(0, 20);
    const contacts = s.events.filter((e) => e.sub === 'first-contact' && ((e.data.landmasses as number[] | undefined) ?? []).includes(lm) && T.pageRefs.has(`evt:${e.id}`));
    const colonies = s.events.filter((e) => e.sub === 'colonization' && e.cell >= 0 && s.world.landmass[e.cell] === lm && T.pageRefs.has(`evt:${e.id}`));
    const kind = cont.cells < 300 ? 'island group' : 'continent';
    pg.summary = `${T.title.get(ref)} is ${kind === 'continent' ? 'a continent' : 'an island group'} of ${plural(cont.cells, 'district')} (${fmtNum(cont.cells * s.world.cellArea)} km²), divided into ${plural(regions.length, 'region')}.${contacts.length ? ` It first made contact with another landmass in ${yr(contacts[0].year)}.` : ''}`;
    const meaning = s.lang.nameMeaning(cont.nameId);
    pg.infobox = [
      ['Kind', kind], ['Districts', String(cont.cells)], ['Area', `${fmtNum(cont.cells * s.world.cellArea)} km²`], ['Regions', String(regions.length)],
      ...(meaning ? [['Name means', `“${meaning}”`] as [string, string]] : []),
      ...(contacts.length ? [['First contact', LT(T, `evt:${contacts[0].id}`)] as [string, string]] : []),
    ];
    const body: string[] = ['## Regions', '', regions.map((r) => `- ${L(T, `reg:${r}`)}`).join('\n')];
    if (states.length) body.push('', '## Great states', '', states.map((p) => `- ${LT(T, `pol:${p.id}`)} (${span(p.born, p.died)}, at most ${plural(peak.get(p.id) ?? 0, 'district')})`).join('\n'));
    if (contacts.length) body.push('', '## Contacts across the sea', '', contacts.map((e) => `- **${yr(e.year)}**: ${LT(T, `evt:${e.id}`)}`).join('\n'));
    if (colonies.length) body.push('', '## Colonies planted here', '', colonies.slice(0, 40).map((e) => `- **${yr(e.year)}**: ${LT(T, `evt:${e.id}`)}`).join('\n'));
    pg.body = body.join('\n');
    pg.names = nameHistory(ctx, cont.nameId, (y) => { const cu = ctx.cultureAt(cont.labelCell, y); return cu >= 0 ? s.cultures[cu].lang : 0; }, 0, 5000, exoLangs(cont.labelCell));
    pages.set(ref, pg);
  }

  for (let i = 0; i < s.world.rivers.length; i++) {
    const ref = `riv:${i}`;
    const rv = s.world.rivers[i];
    const mid = rv.cells[Math.floor(rv.cells.length / 2)];
    const pg = blank(ref, T, 'river', -3000, 5000, mid);
    const regions = [...new Set(rv.cells.map((c) => s.world.region[c]))];
    pg.summary = `The ${T.title.get(ref)} flows ${rv.cells.length * 90} km through ${regions.length} regions to the sea.`;
    pg.infobox = [['Length', `about ${rv.cells.length * 90} km`], ['Regions', regions.map((x) => L(T, `reg:${x}`)).join(', ')], ['Mouth', L(T, `reg:${s.world.region[rv.cells[rv.cells.length - 1]]}`)]];
    pg.body = `## Course\n\nFrom ${L(T, `reg:${s.world.region[rv.cells[0]]}`)} to ${L(T, `reg:${s.world.region[rv.cells[rv.cells.length - 1]]}`)}. Cities on its banks: ${s.settlements.filter((t) => rv.cells.includes(t.cell)).map((t) => L(T, `set:${t.id}`)).join(', ') || 'none'}.`;
    pg.names = nameHistory(ctx, s.riverNames[i], (y) => { const cu = ctx.cultureAt(mid, y); return cu >= 0 ? s.cultures[cu].lang : 0; }, 0, 5000, exoLangs(mid));
    pages.set(ref, pg);
  }

  // ---------------------------------------------------------------- cultures, languages, scripts
  for (const c of s.cultures) {
    const ref = `cul:${c.id}`;
    const pg = blank(ref, T, c.pastoral ? 'pastoral' : 'settled', c.born, c.died ?? 5000, c.homeCell);
    const daughters = s.cultures.filter((x) => x.parent === c.id);
    pg.summary = `The ${T.short.get(ref)} are a ${c.pastoral ? 'pastoral' : 'settled'} people speaking ${T.short.get(`lan:${c.lang}`)}${c.parent !== null ? `, who emerged from the ${T.short.get(`cul:${c.parent}`)}` : ''} (${span(c.born, c.died)}).`;
    pg.infobox = [
      ['Language', L(T, `lan:${c.lang}`)],
      ['Ancestral religion', L(T, `mov:${c.pantheon}`)],
      ['Script', c.script >= 0 ? L(T, `scr:${c.script}`) : 'none'],
      ...(c.parent !== null ? [['Parent people', L(T, `cul:${c.parent}`)] as [string, string]] : []),
      ...(daughters.length ? [['Daughter peoples', daughters.map((x) => L(T, `cul:${x.id}`)).join(', ')] as [string, string]] : []),
      ['Way of life', c.pastoral ? 'herding' : 'farming and towns'],
    ];
    const states = s.polities.filter((p) => p.culture === c.id);
    const cevs = eventsOf(ctx, ref);
    pg.body = [`## States of the ${T.short.get(ref)}`, '', states.length ? states.slice(0, 60).map((p) => `- ${LT(T, `pol:${p.id}`)} (${span(p.born, p.died)})`).join('\n') : '*The archive records no state founded by this people.*', ...(cevs.length ? ['', '## Events', '', eventList(ctx, T, cevs, 30)] : [])].join('\n');
    pg.names = nameHistory(ctx, c.nameId, () => c.lang, c.born, c.died ?? 5000, [ctx.editorialLang]);
    pages.set(ref, pg);
  }
  for (const info of s.lang.languages()) {
    const ref = `lan:${info.id}`;
    const pg = blank(ref, T, info.parent === null ? 'proto-language' : 'language', info.born, info.died ?? 5000, -1);
    const daughters = s.lang.languages().filter((x) => x.parent === info.id);
    const speakers = s.cultures.filter((c) => c.lang === info.id);
    if (speakers.length) pg.cell = speakers[0].homeCell;
    pg.summary = `${T.title.get(ref)}: ${info.parent === null ? 'the reconstructed ancestor of a language family' : `a language descended from ${T.short.get(`lan:${info.parent}`)}`} (${span(info.born, info.died)}). Word order ${info.typology.order}${info.typology.cases.length ? `, with ${plural(info.typology.cases.length, 'case')}` : ', without case endings'}.`;
    pg.infobox = [
      ['Spoken', span(info.born, info.died)],
      ...(info.parent !== null ? [['Parent', L(T, `lan:${info.parent}`)] as [string, string]] : []),
      ['Family', L(T, `lan:${rootOf(ctx, info.id)}`)],
      ['Word order', info.typology.order],
      ['Cases', info.typology.cases.join(', ') || 'none'],
      ['Speakers', speakers.map((c) => L(T, `cul:${c.id}`)).join(', ') || 'none recorded'],
      ['Phonology', (() => { const inv = s.lang.inventory(info.id, Math.min(info.died ?? 5000, 5000)); return `${inv.consonants.length} consonants, ${inv.vowels.length} vowels`; })()],
    ];
    const sc = s.lang.soundChanges(info.id);
    const concepts = ['water', 'king', 'god', 'city', 'mother', 'fire', 'silver', 'river', 'sun', 'war', 'peace', 'one', 'two', 'three'];
    const end = Math.min(info.died ?? 5000, 5000);
    const sample = [info.born, Math.round((info.born + end) / 2), end].filter((y, i, a) => a.indexOf(y) === i);
    pg.language = {
      soundChanges: sc.map((c) => ({ year: c.year, rule: c.rule, label: c.label, lang: T.short.get(`lan:${c.lang}`) ?? '' })),
      words: concepts.map((cn) => ({ concept: cn, forms: sample.map((y) => [y, s.lang.word(info.id, cn, Math.max(y, info.born)).conventional] as [number, string]) })),
      daughters: daughters.map((x) => `lan:${x.id}`),
      parent: info.parent !== null ? `lan:${info.parent}` : null,
    };
    pg.body = [
      '## Sound changes',
      '',
      sc.length ? sc.map((c) => `- **${yr(c.year)}** (${L(T, `lan:${c.lang}`)}): ${c.label}: \`${c.rule}\``).join('\n') : '*none recorded*',
      '',
      '## Daughter languages',
      '',
      daughters.length ? daughters.map((x) => `- ${LT(T, `lan:${x.id}`)}`).join('\n') : '*none*',
    ].join('\n');
    pages.set(ref, pg);
  }
  for (const sc of s.scripts) {
    const ref = `scr:${sc.id}`;
    const pg = blank(ref, T, sc.kind, sc.born, 5000, s.cultures[sc.culture].homeCell);
    const children = s.scripts.filter((x) => x.parent === sc.id);
    pg.summary = `The ${T.title.get(ref)} is ${article(sc.kind)} ${sc.kind} writing system, ${sc.parent === null ? 'invented' : 'adapted'} by the ${T.short.get(`cul:${sc.culture}`)} in ${yr(sc.born)}.`;
    pg.infobox = [
      ['Type', sc.kind],
      ['Created', LT(T, `evt:${sc.event}`)],
      ['People', L(T, `cul:${sc.culture}`)],
      ...(sc.parent !== null ? [['Derived from', L(T, `scr:${sc.parent}`)] as [string, string]] : []),
      ...(children.length ? [['Descendants', children.map((x) => L(T, `scr:${x.id}`)).join(', ')] as [string, string]] : []),
      ...(sc.kind === 'logographic' || sc.kind === 'logosyllabic' ? [['Logograms read in', L(T, `lan:${sc.originLang}`)] as [string, string]] : []),
    ];
    pg.body = `## About\n\n${scriptBlurb(sc.kind)}`;
    pages.set(ref, pg);
  }

  // ---------------------------------------------------------------- movements, deities
  for (const m of s.movements) {
    const ref = `mov:${m.id}`;
    const pg = blank(ref, T, m.kind, m.born, m.died ?? 5000, m.originCell);
    const children = s.movements.filter((x) => x.parent === m.id);
    pg.summary = `${T.title.get(ref)}: ${m.kind === 'pantheon' ? `the ancestral religion of the ${T.short.get(`cul:${m.culture}`)}` : `a ${m.kind} founded ${m.founder !== null ? `by ${T.short.get(`per:${m.founder}`)} ` : ''}in ${yr(m.born)}`}. At its height it counted about ${fmtNum(m.peak)} adherents.`;
    pg.infobox = [
      ['Kind', m.kind],
      ...(m.founder !== null ? [['Founder', L(T, `per:${m.founder}`)] as [string, string]] : []),
      ...(m.foundEvent !== null ? [['Founded', LT(T, `evt:${m.foundEvent}`)] as [string, string]] : []),
      ...(m.parent !== null ? [['Broke from', L(T, `mov:${m.parent}`)] as [string, string]] : []),
      ...(children.length ? [['Offshoots', children.map((x) => L(T, `mov:${x.id}`)).join(', ')] as [string, string]] : []),
      ['People', L(T, `cul:${m.culture}`)],
      ['Peak adherents', fmtNum(m.peak)],
    ];
    const body: string[] = ['## Teachings', '', tenetText(m.kind, m.tenets)];
    if (m.deities.length) body.push('', '## Gods', '', m.deities.map((x) => `- ${L(T, `dei:${x}`)}: ${s.deities[x].domain}`).join('\n'));
    const states = s.polities.filter((p) => (ctx.polityStats.get(p.id) ?? []).some((r) => r[11] === m.id));
    if (states.length) body.push('', '## States that professed it', '', states.slice(0, 40).map((p) => `- ${LT(T, `pol:${p.id}`)}`).join('\n'));
    const mevs = eventsOf(ctx, ref);
    if (mevs.length) body.push('', '## Events', '', eventList(ctx, T, mevs, 30));
    pg.body = body.join('\n');
    pages.set(ref, pg);
  }
  for (const dd of s.deities) {
    const ref = `dei:${dd.id}`;
    const pg = blank(ref, T, dd.domain, dd.born, 5000, s.cultures[dd.culture].homeCell);
    const meaning = s.lang.nameMeaning(dd.nameId);
    pg.summary = `${T.short.get(ref)} is the ${dd.sex === 'f' ? 'goddess' : 'god'} of ${domainPhrase(dd.domain)} in the ancestral religion of the ${T.short.get(`cul:${dd.culture}`)}.`;
    pg.infobox = [['Domain', dd.domain], ['Religion', L(T, `mov:${dd.movement}`)], ['People', L(T, `cul:${dd.culture}`)], ...(meaning ? [['Name means', `“${meaning}”`] as [string, string]] : [])];
    pg.body = `## Worship\n\nInvoked in oaths, dedications and curses wherever the ${L(T, `mov:${dd.movement}`)} religion was practised.`;
    pg.names = nameHistory(ctx, dd.nameId, () => s.cultures[dd.culture].lang, Math.max(dd.born, s.lang.info(s.cultures[dd.culture].lang).born), 5000, [ctx.editorialLang]);
    pages.set(ref, pg);
  }

  // ---------------------------------------------------------------- currencies, houses
  for (const c of s.currencies) {
    const ref = `cur:${c.id}`;
    const pg = blank(ref, T, c.kind, c.born, c.died ?? 5000, s.settlements[s.polities[c.polity].capital].cell);
    pg.summary = `The ${T.short.get(ref)} was ${c.kind === 'weight' ? 'a weight standard of silver' : c.kind === 'coin' ? `a ${c.metal} coin` : c.kind === 'paper' ? 'a banknote currency' : 'a fiat currency'} of ${T.short.get(`pol:${c.polity}`)}, ${span(c.born, c.died)}. It began at ${sig3(c.history[0][1])} g of silver${c.history.length > 1 ? ` and ended at ${sig3(c.history[c.history.length - 1][1])} g` : ''}.`;
    pg.infobox = [['Issuer', LT(T, `pol:${c.polity}`)], ['Kind', c.kind], ['Metal', c.metal], ['Introduced', LT(T, `evt:${c.event}`)], ['Initial value', `${sig3(c.history[0][1])} g silver`], ['Final value', `${sig3(c.history[c.history.length - 1][1])} g silver`]];
    pg.series = [{ label: 'Silver value', unit: 'g', points: c.history.map(([y, v]) => [y, v] as [number, number]) }];
    pg.body = ['## History', '', eventList(ctx, T, eventsOf(ctx, ref), 30)].join('\n');
    pages.set(ref, pg);
  }
  for (const h of s.houses) {
    const ref = `hou:${h.id}`;
    const pg = blank(ref, T, h.kind, h.born, h.died ?? 5000, s.settlements[h.settlement].cell);
    pg.summary = `The ${T.short.get(ref)} was a ${h.kind === 'house' ? 'merchant house' : h.kind} of ${T.short.get(`set:${h.settlement}`)}, ${span(h.born, h.died)}, dealing in ${h.goods.map((x) => GOODS[x].name).join(', ')}.`;
    pg.infobox = [
      ['Seat', L(T, `set:${h.settlement}`)],
      ['Founder', L(T, `per:${h.founder}`)],
      ['Founded', LT(T, `evt:${h.foundEvent}`)],
      ...(h.endEvent !== null && T.pageRefs.has(`evt:${h.endEvent}`) ? [['End', LT(T, `evt:${h.endEvent}`)] as [string, string]] : []),
      ['Goods', h.goods.map((x) => GOODS[x].name).join(', ')],
      ['Kind', h.kind],
    ];
    pg.body = ['## Heads of the house', '', h.heads.map(([y, p]) => `- ${L(T, `per:${p}`)} (from ${yr(y)})`).join('\n'), '', '## Events', '', eventList(ctx, T, eventsOf(ctx, ref), 20)].join('\n');
    pages.set(ref, pg);
  }

  // ---------------------------------------------------------------- climate anomalies, techs
  for (const a of s.anomalies) {
    const ref = `cli:${a.id}`;
    const cell = a.volcanoCell >= 0 ? a.volcanoCell : a.cells[Math.floor(a.cells.length / 2)] ?? -1;
    const pg = blank(ref, T, a.kind, a.start, a.end, cell);
    const cellSet = new Set(a.cells);
    const caused = new Set(ctx.childrenEvents.get(a.event) ?? []);
    const consequences = s.events.filter((e) => isPageEvent(e) && (caused.has(e.id) || (e.sub === 'famine' && e.year >= a.start && e.year <= a.end + 5 && (cellSet.size === 0 || cellSet.has(e.cell))))).sort((x, y) => x.year - y.year || x.id - y.id);
    pg.summary = `${T.title.get(ref)}: ${a.kind === 'eruption' ? `a volcanic eruption (VEI ${a.severity}) and the cold years that followed` : a.kind === 'drought' ? `a drought across ${a.cells.length} districts` : a.kind === 'cold' ? `a period of cold years (${a.severity.toFixed(2)} °C below normal)` : 'the warming of the climate by the burning of coal and oil'}, ${span(a.start, a.end)}.`;
    pg.infobox = [['Kind', a.kind], ['Period', span(a.start, a.end)], ['Onset', LT(T, `evt:${a.event}`)], ['Extent', a.cells.length ? `${a.cells.length} districts` : 'world-wide'], ['Severity', a.kind === 'eruption' ? `VEI ${a.severity}` : a.severity.toFixed(2)]];
    pg.body = ['## Consequences', '', consequences.length ? eventList(ctx, T, consequences, 40) : '*No recorded consequences.*'].join('\n');
    pages.set(ref, pg);
  }
  for (const tech of TECHS) {
    const ref = `tec:${tech.id}`;
    const holders: [number, number][] = [];
    for (const p of s.polities) { const y = p.techs.get(tech.id); if (y !== undefined) holders.push([y, p.id]); }
    holders.sort((a, b) => a[0] - b[0]);
    const inventions = s.events.filter((e) => e.sub === 'invention' && e.data.tech === tech.id);
    const first = holders[0];
    const pg = blank(ref, T, `era-${tech.era}`, first ? first[0] : tech.target, 5000, first ? s.settlements[s.polities[first[1]].capital].cell : -1);
    pg.summary = first ? `${tech.name}, first known in ${T.short.get(`pol:${first[1]}`)} in ${yr(first[0])}. Known to ${plural(holders.length, 'state')} in all.` : `${tech.name}: never achieved before AY 5000.`;
    pg.infobox = [['First known', first ? `${yr(first[0])}, ${L(T, `pol:${first[1]}`)}` : 'never'], ['Requires', tech.prereqs.map((q) => L(T, `tec:${q}`)).join(', ') || '—'], ['Leads to', TECHS.filter((x) => x.prereqs.includes(tech.id)).map((x) => L(T, `tec:${x.id}`)).join(', ') || '—']];
    pg.body = holders.length
      ? ['## Inventions', '', inventions.length ? inventions.map((e) => `- ${LT(T, `evt:${e.id}`)}`).join('\n') : '*Learned by contact only.*', '', '## Spread', '', holders.slice(0, 30).map(([y, p]) => `- ${yr(y)}: ${L(T, `pol:${p}`)}`).join('\n')].join('\n')
      : '*No state of the archive achieved this before AY 5000.*';
    pg.series = [{ label: 'States knowing it', unit: 'states', points: cumulative(holders.map(([y]) => y)) }];
    pages.set(ref, pg);
  }

  // ---------------------------------------------------------------- events
  for (const e of s.events) {
    const ref = `evt:${e.id}`;
    if (!T.pageRefs.has(ref)) continue;
    const pg = blank(ref, T, e.sub, e.year, e.end, e.cell);
    const d = describeEvent(ctx, T, e);
    pg.summary = d.summary;
    pg.infobox = d.infobox;
    const causes = e.causes.filter((c) => T.pageRefs.has(`evt:${c}`));
    const effects = (ctx.childrenEvents.get(e.id) ?? []).filter((c) => T.pageRefs.has(`evt:${c}`));
    const body: string[] = [d.body];
    const dated = (c: number) => { const t = T.title.get(`evt:${c}`) ?? ''; return `- ${LT(T, `evt:${c}`)}${t.includes(`AY ${s.events[c].year}`) ? '' : ` (${yr(s.events[c].year)})`}`; };
    if (causes.length) body.push('', '## Causes', '', causes.map(dated).join('\n'));
    if (effects.length) body.push('', '## Consequences', '', effects.slice(0, 40).map(dated).join('\n'));
    const docs = artsBy.get(ref) ?? [];
    if (docs.length) body.push('', '## Sources', '', docList(T, docs));
    pg.body = body.join('\n');
    pages.set(ref, pg);
  }
  return pages;
}

function sig3(x: number): string {
  if (x === 0) return '0';
  const d = Math.max(0, 2 - Math.floor(Math.log10(Math.abs(x))));
  return x.toFixed(Math.min(6, d));
}

const GOV_LABEL: Record<string, string> = {
  'city-state': 'city-state', 'merchant-republic': 'merchant republic', 'feudal-kingdom': 'feudal kingdom', 'absolute-monarchy': 'absolute monarchy',
  'constitutional-monarchy': 'constitutional monarchy', 'one-party-state': 'one-party state',
};
function govLabel(g: string): string {
  return GOV_LABEL[g] ?? g.replace(/-/g, ' ');
}
function article(w: string): string {
  return /^[aeiou]/i.test(w) && !/^(one|uni|eu)/i.test(w) ? 'an' : 'a';
}
function plural(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? '' : 's'}`;
}
function joinList(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

function compressOwners(hist: [number, number][], from: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < hist.length; i++) {
    const [y, o] = hist[i];
    const next = i + 1 < hist.length ? hist[i + 1][0] : 5000;
    if (next < from) continue;
    const a = Math.max(y, from);
    if (out.length && out[out.length - 1][2] === o) out[out.length - 1][1] = next;
    else out.push([a, next, o]);
  }
  return out.filter(([a, b]) => b > a);
}

function thin(points: [number, number][], max: number): [number, number][] {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out: [number, number][] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

function cumulative(years: number[]): [number, number][] {
  const sorted = years.slice().sort((a, b) => a - b);
  const out: [number, number][] = [];
  sorted.forEach((y, i) => out.push([y, i + 1]));
  return thin(out, 60);
}

function rootOf(ctx: Ctx, lang: number): number {
  let l = lang;
  for (;;) {
    const p = ctx.s.lang.info(l).parent;
    if (p === null) return l;
    l = p;
  }
}

function scriptBlurb(kind: string): string {
  switch (kind) {
    case 'logographic': return 'Each sign stands for a word. Scribes needed years of training, and literacy stayed a palace monopoly.';
    case 'logosyllabic': return 'A mixed system: frequent words are written with word-signs (logograms), the rest spelled out in syllable signs. Determinatives mark gods, places and persons. Transliterations write logograms in capitals.';
    case 'syllabary': return 'Each sign stands for a syllable. Consonant clusters are broken with "echo" vowels, so spellings only approximate speech.';
    case 'abjad': return 'Only consonants are written, with a few letters doing double duty for long vowels. Readers supplied the vowels from knowledge of the language.';
    default: return 'An alphabet: consonants and vowels both have letters. Its small sign inventory spread literacy far beyond the court.';
  }
}

export function tenetText(kind: string, t: number[]): string {
  const [cosmos, divine, authority, ethic, world, scope] = t;
  if (kind === 'ideology') {
    return [
      cosmos > 0 ? 'History moves forward toward a better order, and the movement claims to know its direction.' : 'It distrusts grand plans, holding that societies grow rather than being made.',
      divine > 0 ? 'Power should be concentrated in a strong state that can act.' : 'Power should be divided and checked.',
      authority > 0 ? 'Discipline and the party line come before individual opinion.' : 'Every citizen may judge for themselves.',
      ethic > 0 ? 'Duty to the nation and its order is the highest virtue.' : 'Solidarity with the weak is the highest virtue.',
      world > 0 ? 'Austerity and sacrifice now for the future.' : 'Prosperity and comfort are legitimate goals.',
      scope > 0 ? 'Its cause is that of all peoples.' : 'Its cause is that of its own nation.',
    ].join(' ');
  }
  return [
    cosmos > 0.2 ? 'Time runs in a line from creation to a final judgement.' : cosmos < -0.2 ? 'All things turn on a great wheel; what ends will begin again.' : 'It says little of the world\'s beginning or end.',
    divine > 0.3 ? 'There is one divine power, and the old gods are its servants or shadows.' : divine < -0.3 ? 'Many gods share the world, each with their place and due.' : 'The divine is a principle more than a person.',
    authority > 0.2 ? 'Truth is kept by an ordained priesthood and passed down in order.' : authority < -0.2 ? 'Each seeker may find the truth by inner light and reason.' : 'Teachers are honoured, but no one owns the truth.',
    ethic > 0.2 ? 'The good life is the life of duty, order and right sacrifice.' : ethic < -0.2 ? 'The good life is the life of compassion and release from suffering.' : 'It asks for justice in dealings and moderation in all things.',
    world > 0.2 ? 'The wise withdraw from wealth and appetite.' : world < -0.2 ? 'Prosperity is a sign of divine favour.' : '',
    scope > 0.3 ? 'Its message is for all peoples, and its followers seek converts.' : scope < -0.3 ? 'It belongs to one people and does not seek converts.' : '',
  ].filter(Boolean).join(' ');
}

function polityNarrative(ctx: Ctx, T: Titles, p: Polity, evs: SimEvent[]): string {
  const s = ctx.s;
  const parts: string[] = [];
  const fe = s.events[p.foundEvent];
  const how = fe.sub === 'founding' ? 'arose as a city-state' : fe.sub === 'successor-state' ? `emerged from the ${LT(T, fe.causes.length ? `evt:${fe.causes[0]}` : `pol:${p.predecessor}`)}` : fe.sub === 'revolt' ? 'began as a revolt' : fe.sub === 'civil-war' ? 'began as a breakaway faction in a civil war' : 'was founded';
  parts.push(`${T.short.get(`pol:${p.id}`)} ${how} at ${L(T, `set:${p.capitals[0][1]}`)} in ${yr(p.born)}.`);
  const wars = evs.filter((e) => e.sub === 'war');
  const won = evs.filter((e) => (e.sub === 'treaty' || e.sub === 'conquest') && e.parts.some(([r, role]) => r === `pol:${p.id}` && role === 'victor')).length;
  const lost = evs.filter((e) => (e.sub === 'treaty' || e.sub === 'conquest') && e.parts.some(([r, role]) => r === `pol:${p.id}` && role === 'vanquished')).length;
  if (wars.length) parts.push(`It fought ${plural(wars.length, 'war')}${won + lost ? `, emerging the victor from ${won} settlement${won === 1 ? '' : 's'} and the loser from ${lost}` : ''}.`);
  const big = wars.slice().sort((a, b) => b.sig - a.sig)[0];
  if (big) parts.push(`The most consequential was the ${LT(T, `evt:${big.id}`)}.`);
  const conv = evs.filter((e) => e.sub === 'conversion');
  if (conv.length) parts.push(`It changed its official religion ${conv.length === 1 ? 'once' : `${conv.length} times`}, first in ${yr(conv[0].year)} (${LT(T, `evt:${conv[0].id}`)}).`);
  const rev = evs.filter((e) => e.sub === 'revolution' || e.sub === 'reform');
  if (rev.length) parts.push(`Its government was remade ${rev.length === 1 ? 'once' : `${rev.length} times`}${rev.some((x) => x.sub === 'revolution') ? ', including by revolution' : ''}.`);
  if (p.endEvent !== null) {
    const ee = s.events[p.endEvent];
    const after = ee.causes.slice(0, 3).filter((c) => T.pageRefs.has(`evt:${c}`)).map((c) => `the ${LT(T, `evt:${c}`)}`);
    parts.push(`It ended in ${yr(p.died)} with the ${LT(T, `evt:${ee.id}`)}${after.length ? `, after ${joinList(after)}` : ''}.`);
  } else parts.push('It survives to the present day.');
  return parts.join(' ');
}

function personNarrative(ctx: Ctx, T: Titles, pid: number, evs: SimEvent[]): string {
  const s = ctx.s;
  const p = s.persons[pid];
  const parts: string[] = [];
  parts.push(`${T.short.get(`per:${pid}`)} was born in ${yr(p.born)} among the ${L(T, `cul:${p.culture}`)}${p.father !== null && T.pageRefs.has(`per:${p.father}`) ? `, child of ${L(T, `per:${p.father}`)}` : ''}.`);
  for (const r of p.roles) {
    const where = r.polity !== null ? ` of ${L(T, `pol:${r.polity}`)}` : '';
    if (r.role === 'ruler') parts.push(`${p.sex === 'f' ? 'She' : 'He'} reigned${where} from ${yr(r.start)}${r.end !== null ? ` to ${yr(r.end)}` : ''}.`);
    else if (r.role === 'general') parts.push(`${p.sex === 'f' ? 'She' : 'He'} served as a commander${where}.`);
    else if (r.role === 'merchant') parts.push(`${p.sex === 'f' ? 'She' : 'He'} headed ${r.ref ? L(T, r.ref) : 'a merchant house'}.`);
    else if (r.role === 'prophet' || r.role === 'philosopher') parts.push(`${p.sex === 'f' ? 'She' : 'He'} founded ${r.ref ? L(T, r.ref) : 'a movement'} in ${yr(r.start)}.`);
    else if (r.role === 'inventor') parts.push(`${p.sex === 'f' ? 'She' : 'He'} is credited with an invention in ${yr(r.start)}.`);
    else parts.push(`${p.sex === 'f' ? 'She' : 'He'} was a ${r.role}${where}.`);
  }
  const battles = evs.filter((e) => e.sub === 'battle');
  if (battles.length) {
    const wins = battles.filter((b) => b.parts.some(([r, role]) => role === 'victor' && b.parts.some(([x, rr]) => x === `per:${pid}` && (rr === 'attacking commander' ? r === b.parts.find(([, q]) => q === 'attacker')?.[0] : r === b.parts.find(([, q]) => q === 'defender')?.[0])))).length;
    parts.push(`${p.sex === 'f' ? 'She' : 'He'} commanded in ${battles.length} battle${battles.length > 1 ? 's' : ''}, winning ${wins}.`);
  }
  if (p.died < 5000) parts.push(`${p.sex === 'f' ? 'She' : 'He'} died in ${yr(p.died)}${p.deathCause !== 'natural' ? ` (${p.deathCause})` : ''} at the age of ${p.died - p.born}.`);
  void ordinal;
  void cap;
  return parts.join(' ');
}

export type { Term };
