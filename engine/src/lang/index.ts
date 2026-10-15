// LanguageEngine: evolving languages with documented sound changes, deterministic name
// coinage, borrowing (exonyms), and glossed inscriptions. See docs/lld/language.md.

import { Rng, mixSeed } from '../core/rng.ts';
import { CONCEPTS, CONCEPT_INDEX, LOGOGRAM_CONCEPTS, conceptDef } from './concepts.ts';
import type { Concept } from './concepts.ts';
import {
  STYLES, STYLE_BY_ID, PHONS, P, hasSym, isV, isC, sym, makeProtoPhonology, genRoot, profileOf, adaptTo, join, key,
} from './phonology.ts';
import type { ProtoPhonology, Profile, Style } from './phonology.ts';
import { applyRule, proposeRule, ruleOutputs } from './changes.ts';
import type { RuleSpec } from './changes.ts';
import { makeMorphology } from './morphology.ts';
import type { Morphology } from './morphology.ts';
import { makeOrthography, conventional, scholarly, ipa, capitalize, syllabicSpelling, abjadSpelling, DETERMINATIVES } from './romanize.ts';
import type { Orthography } from './romanize.ts';
import { coin } from './names.ts';
import { translate } from './english.ts';
import type {
  LangId, NameId, NameKind, ScriptKind, Realized, SoundChange, LanguageInfo, NounPhrase, Clause, Token, RenderedText,
} from './types.ts';

export type {
  LangId, NameId, NameKind, ScriptKind, Realized, SoundChange, LanguageInfo, NounPhrase, Clause, Token, RenderedText, Concept,
};
export { CONCEPTS, conceptDef } from './concepts.ts';

const RULE_GAP = 210;
const LEX_GAP = 320;

interface MatRule { year: number; spec: RuleSpec; uid: string; lang: number }
interface LexRepl { year: number; concept: Concept; form: number[] }

interface LangRec {
  id: number;
  parent: number | null;
  family: number;
  root: number;
  seedKey: string;
  born: number;
  died: number | null;
  style: Style;
  pp: ProtoPhonology;
  morph: Morphology;
  protoLex: Map<Concept, number[]>;
  orth: Orthography;
  rules: MatRule[];
  lex: LexRepl[];
  ruleRng: Rng;
  nextRule: number;
  lexRng: Rng;
  nextLex: number;
  frontier: number;
  snap: number[][];
  symInv: Set<number>;
  labels: Map<string, number>;
  children: number[];
  endonym: number;
  materializing: boolean;
}

interface NameRec {
  id: number;
  kind: NameKind;
  lang: number;
  year: number;
  segs: number[][];
  joiner: '' | '-' | ' ';
  meaning: string | null;
  chain: { lang: number; year: number }[];
}

interface Piece { ph: number[]; gloss: string; stem: boolean }
interface ITok {
  pieces: Piece[];           // surface order
  isName: boolean;
  nameSegCount: number;      // for names: how many leading pieces are name segments
  joiner: '' | '-' | ' ';
  concept?: Concept;
  numeral?: number;
  det?: string;
  particle?: boolean;
}

function gap(rng: Rng, mean: number): number {
  return Math.max(20, Math.round(-Math.log(1 - rng.next()) * mean));
}

const ADP_GLOSS: Record<string, string> = {
  'ADP.DAT': 'to', 'ADP.LOC': 'in', 'ADP.INS': 'with', 'ADP.ABL': 'from', 'ADP.COM': 'with', 'ADP.BEN': 'for', 'ADP.GEN': 'of',
};
const ROLE_CASE: Record<string, [string, string]> = {
  dative: ['DAT', 'ADP.DAT'],
  benefactive: ['DAT', 'ADP.BEN'],
  locative: ['LOC', 'ADP.LOC'],
  instrumental: ['INS', 'ADP.INS'],
  ablative: ['ABL', 'ADP.ABL'],
  comitative: ['COM', 'ADP.COM'],
};

export class LanguageEngine {
  readonly seed: number;
  private langs: LangRec[] = [];
  private names: NameRec[] = [];
  private contacts = new Map<string, number>();
  private contactVersion = 0;
  private familyCount = 0;
  private restoring = false;

  private pathCache = new Map<number, LangRec[]>();
  private evolveCache = new WeakMap<number[], Map<string, number[]>>();
  private nameCache = new Map<number, Map<string, { segs: number[][]; joiner: '' | '-' | ' ' }>>();
  private contactCache = new Map<string, number>();
  private profileCache = new Map<string, Profile>();
  private snapCache = new Map<string, number[][]>();

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  // ------------------------------------------------------------ lifecycle

  createProto(year: number, seedKey: string | number): LangId {
    const sk = String(seedKey);
    const rng = new Rng(mixSeed(this.seed, 'proto', sk));
    const usedStyles = new Set(this.langs.filter((l) => l.parent === null).map((l) => l.style.id));
    const unused = STYLES.filter((s) => !usedStyles.has(s.id));
    const style = unused.length ? rng.pick(unused) : rng.pick(STYLES);
    const pp = makeProtoPhonology(style, rng.fork('phon'));
    const morph = makeMorphology(pp, rng.fork('morph'));
    const protoLex = new Map<Concept, number[]>();
    const lexRng = rng.fork('lex');
    const taken = new Set<string>();
    for (const c of CONCEPTS) {
      const syl = c.core || c.pos === 'num' ? style.sylCore : style.sylOther;
      let w: number[] = [];
      for (let tries = 0; tries < 8; tries++) {
        const n = lexRng.weighted(syl.map((s) => s[0]), syl.map((s) => s[1]));
        w = genRoot(pp, lexRng, n);
        if (!taken.has(key(w))) break;
      }
      taken.add(key(w));
      protoLex.set(c.id, w);
    }
    const id = this.langs.length;
    const symInv = new Set<number>([...pp.consonants, ...pp.vowels]);
    for (const w of protoLex.values()) for (const p of w) symInv.add(p);
    const L: LangRec = {
      id, parent: null, family: this.familyCount++, root: id, seedKey: sk, born: year, died: null, style, pp, morph, protoLex,
      orth: makeOrthography(style, rng.fork('orth')),
      rules: [], lex: [],
      ruleRng: new Rng(mixSeed(this.seed, 'rules', sk)), nextRule: 0,
      lexRng: new Rng(mixSeed(this.seed, 'lexrepl', sk)), nextLex: 0,
      frontier: year, snap: [...protoLex.values()], symInv, labels: new Map(), children: [], endonym: -1, materializing: false,
    };
    L.nextRule = year + gap(L.ruleRng, RULE_GAP);
    L.nextLex = year + gap(L.lexRng, LEX_GAP);
    this.langs.push(L);
    if (!this.restoring) L.endonym = this.coinName(id, year, 'language', `endonym:${sk}`);
    return id;
  }

  split(parent: LangId, year: number, seedKey: string | number): LangId {
    const sk = String(seedKey);
    const Pa = this.lang(parent);
    if (Pa.died !== null && year > Pa.died) throw new Error(`cannot split language ${parent} after its death`);
    this.ensure(Pa, year);
    const rng = new Rng(mixSeed(this.seed, 'split', sk));
    const id = this.langs.length;
    const lineageRules = this.applicableRules(Pa.root, -Infinity, parent, year);
    const symInv = new Set<number>([...this.lang(Pa.root).symInv]);
    // root symInv may include later root rules; rebuild from proto + lineage outputs
    symInv.clear();
    const root = this.lang(Pa.root);
    for (const p of [...root.pp.consonants, ...root.pp.vowels]) symInv.add(p);
    for (const w of root.protoLex.values()) for (const p of w) symInv.add(p);
    const labels = new Map<string, number>();
    for (const r of lineageRules) {
      for (const p of ruleOutputs(r.spec)) symInv.add(p);
      labels.set(r.spec.label, (labels.get(r.spec.label) ?? 0) + 1);
    }
    const L: LangRec = {
      id, parent, family: Pa.family, root: Pa.root, seedKey: sk, born: year, died: null, style: Pa.style, pp: Pa.pp,
      morph: Pa.morph, protoLex: Pa.protoLex, orth: makeOrthography(Pa.style, rng.fork('orth'), Pa.orth),
      rules: [], lex: [],
      ruleRng: new Rng(mixSeed(this.seed, 'rules', sk)), nextRule: 0,
      lexRng: new Rng(mixSeed(this.seed, 'lexrepl', sk)), nextLex: 0,
      frontier: year, snap: this.snapshotAt(parent, year), symInv, labels, children: [], endonym: -1, materializing: false,
    };
    L.nextRule = year + gap(L.ruleRng, RULE_GAP);
    L.nextLex = year + gap(L.lexRng, LEX_GAP);
    this.langs.push(L);
    Pa.children.push(id);
    if (!this.restoring) L.endonym = this.coinName(id, year, 'language', `endonym:${sk}`);
    return id;
  }

  retire(lang: LangId, year: number): void {
    const L = this.lang(lang);
    if (L.died !== null && L.died <= year) return;
    L.died = year;
    const before = L.rules.length;
    L.rules = L.rules.filter((r) => r.year <= year);
    L.lex = L.lex.filter((r) => r.year <= year);
    if (L.rules.length !== before) {
      L.snap = this.recomputeSnap(L);
    }
    this.clearDerivedCaches();
  }

  advanceTo(year: number): void {
    for (const L of this.langs) this.ensure(L, year);
  }

  recordContact(a: LangId, b: LangId, year: number): void {
    if (a === b) return;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    const cur = this.contacts.get(k);
    if (cur !== undefined && cur <= year) return;
    this.contacts.set(k, year);
    this.contactVersion++;
    this.contactCache.clear();
    this.nameCache.clear();
  }

  // ------------------------------------------------------------ names

  coinName(lang: LangId, year: number, kind: NameKind, seedKey: string | number,
    opts?: { meaning?: Concept[]; parts?: (Concept | NameId)[] }): NameId {
    const L = this.lang(lang);
    this.ensure(L, year);
    const rng = new Rng(mixSeed(this.seed, 'name', String(seedKey)));
    let rootCounter = 0;
    const prof = this.profileAt(L.id, year);
    if (opts?.meaning) for (const c of opts.meaning) conceptDef(c);
    const coined = coin({
      style: L.style,
      rng,
      kind,
      word: (c) => this.wordForm(L.id, c, year),
      deriv: (slot) => {
        const a = L.morph.deriv[slot];
        if (!a) return null;
        return { pos: a.pos, form: this.evolve(a.form, L.root, this.lang(L.root).born, L.id, year) };
      },
      root: (n) => this.freshRoot(L, year, n, rng.fork('root', rootCounter++)),
      name: (id) => this.nameSegs(id, L.id, year).segs,
      nameEn: (id) => {
        const N = this.nameRec(id);
        return this.realize(id, N.lang, Math.max(N.year, Math.min(year, this.lang(N.lang).died ?? year))).conventional;
      },
      ep: prof.epenthetic,
      meaning: opts?.meaning,
      parts: opts?.parts,
    });
    let segs = coined.segs.filter((s) => s.length > 0);
    if (!segs.length || segs.some((s) => !s.some(isV))) segs = [this.freshRoot(L, year, 2, rng.fork('fallback'))];
    const id = this.names.length;
    this.names.push({ id, kind, lang: L.id, year, segs, joiner: segs.length > 1 ? coined.joiner : '', meaning: coined.meaning, chain: [{ lang: L.id, year }] });
    return id;
  }

  localize(name: NameId, lang: LangId, year: number): void {
    const N = this.nameRec(name);
    this.lang(lang);
    // current local language at `year`
    let cur = N.chain[0];
    for (const e of N.chain) if (e.year <= year) cur = e;
    if (cur.lang === lang || this.inherits(lang, cur.lang, cur.year)) return;
    N.chain.push({ lang, year });
    N.chain.sort((a, b) => a.year - b.year);
    this.nameCache.delete(name);
  }

  realize(name: NameId, lang: LangId, year: number): Realized {
    const N = this.nameRec(name);
    const M = this.lang(lang);
    const { segs, joiner } = this.nameSegs(name, lang, year);
    const conv = segs.map((s, i) => {
      const c = conventional(s, M.orth, true);
      return joiner === '-' && i > 0 ? c.toLowerCase() : c;
    }).join(joiner);
    const sch = segs.map((s, i) => {
      const c = scholarly(s, true);
      return joiner === '-' && i > 0 ? c.toLowerCase() : c;
    }).join(joiner);
    void N;
    return { conventional: conv, scholarly: sch, ipa: '/' + segs.map(ipa).join(joiner === ' ' ? ' ' : '') + '/' };
  }

  /** Number of names coined so far (ids are 0..count-1). */
  nameCount(): number {
    return this.names.length;
  }

  nameMeaning(name: NameId): string | null {
    return this.nameRec(name).meaning;
  }

  nameOrigin(name: NameId): { lang: LangId; year: number } {
    const N = this.nameRec(name);
    return { lang: N.lang, year: N.year };
  }

  /** Extension: the kind a name was coined as. */
  nameKind(name: NameId): NameKind {
    return this.nameRec(name).kind;
  }

  // ------------------------------------------------------------ words

  word(lang: LangId, concept: Concept, year: number): Realized {
    const M = this.lang(lang);
    const w = this.wordForm(lang, concept, year);
    return { conventional: conventional(w, M.orth, false), scholarly: scholarly(w, false), ipa: '/' + ipa(w) + '/' };
  }

  protoForm(lang: LangId, concept: Concept): string {
    const L = this.lang(lang);
    const w = L.protoLex.get(concept);
    if (!w) throw new Error(`unknown concept ${concept}`);
    return '*' + scholarly(w, false);
  }

  // ------------------------------------------------------------ introspection

  info(lang: LangId): LanguageInfo {
    const L = this.lang(lang);
    return {
      id: L.id, parent: L.parent, family: L.family, born: L.born, died: L.died, endonym: L.endonym,
      typology: { order: L.morph.order, adposition: L.morph.adposition, cases: [...L.morph.cases] },
    };
  }

  languages(): LanguageInfo[] {
    return this.langs.map((l) => this.info(l.id));
  }

  /** Extension: the phonological archetype of the language's family (e.g. 'sem', 'ura'). */
  familyStyle(lang: LangId): string {
    return this.lang(lang).style.id;
  }

  soundChanges(lang: LangId, upToYear?: number): SoundChange[] {
    const L = this.lang(lang);
    const t = upToYear ?? (L.died ?? L.frontier);
    return this.applicableRules(L.root, -Infinity, lang, t).map((r) => ({ lang: r.lang, year: r.year, rule: r.spec.notation, label: r.spec.label }));
  }

  inventory(lang: LangId, year: number): { consonants: string[]; vowels: string[] } {
    const snap = this.snapshotAt(lang, year);
    const set = new Set<number>();
    for (const w of snap) for (const p of w) set.add(p);
    const ids = [...set].sort((a, b) => a - b);
    return { consonants: ids.filter(isC).map(sym), vowels: ids.filter(isV).map(sym) };
  }

  /** Extension (tests): superset of phonemes that can occur in the language at `year`. */
  symbolicInventory(lang: LangId, year: number): Set<number> {
    const L = this.lang(lang);
    const root = this.lang(L.root);
    const s = new Set<number>([...root.pp.consonants, ...root.pp.vowels]);
    for (const w of root.protoLex.values()) for (const p of w) s.add(p);
    for (const a of Object.values(root.morph.affixes)) for (const p of a.form) s.add(p);
    for (const a of Object.values(root.morph.deriv)) for (const p of a.form) s.add(p);
    for (const a of Object.values(root.morph.particles)) for (const p of a) s.add(p);
    for (const r of this.applicableRules(L.root, -Infinity, lang, year)) for (const p of ruleOutputs(r.spec)) s.add(p);
    return s;
  }

  // ------------------------------------------------------------ text

  renderClause(lang: LangId, year: number, script: { kind: ScriptKind; originLang: LangId }, clauses: Clause[],
    resolveName: (n: NameId) => string): RenderedText {
    const L = this.lang(lang);
    const toks: ITok[] = [];
    for (const c of clauses) toks.push(...this.clauseTokens(L, year, c, resolveName));
    const tokens: Token[] = toks.map((t) => this.tokenOut(t, resolveName));
    const normalized = tokens.map((t) => t.normalized).join(' ');
    const transliteration = this.transliterate(toks, script, L, year);
    return { transliteration, normalized, tokens, translation: translate(clauses, resolveName) };
  }

  // ------------------------------------------------------------ persistence

  toJSON(): unknown {
    return {
      v: 1,
      seed: this.seed,
      langs: this.langs.map((l) => ({ id: l.id, parent: l.parent, born: l.born, died: l.died, seedKey: l.seedKey, endonym: l.endonym })),
      names: this.names.map((n) => ({ k: n.kind, l: n.lang, y: n.year, s: n.segs, j: n.joiner, m: n.meaning, c: n.chain.map((e) => [e.lang, e.year]) })),
      contacts: [...this.contacts.entries()].map(([k, y]) => [...k.split('|').map(Number), y]),
    };
  }

  static fromJSON(data: unknown): LanguageEngine {
    const d = data as {
      v: number; seed: number;
      langs: { id: number; parent: number | null; born: number; died: number | null; seedKey: string; endonym: number }[];
      names: { k: NameKind; l: number; y: number; s: number[][]; j: '' | '-' | ' '; m: string | null; c: [number, number][] }[];
      contacts: [number, number, number][];
    };
    const e = new LanguageEngine(d.seed);
    e.restoring = true;
    for (const l of d.langs) {
      const id = l.parent === null ? e.createProto(l.born, l.seedKey) : e.split(l.parent, l.born, l.seedKey);
      if (id !== l.id) throw new Error('language id mismatch on restore');
      e.langs[id].endonym = l.endonym;
    }
    for (const l of d.langs) if (l.died !== null) e.retire(l.id, l.died);
    e.restoring = false;
    e.names = d.names.map((n, id) => ({ id, kind: n.k, lang: n.l, year: n.y, segs: n.s, joiner: n.j, meaning: n.m, chain: n.c.map(([lang, year]) => ({ lang, year })) }));
    for (const [a, b, y] of d.contacts) e.contacts.set(`${a}|${b}`, y);
    e.contactVersion++;
    return e;
  }

  // ============================================================ internals

  private lang(id: LangId): LangRec {
    const L = this.langs[id];
    if (!L) throw new Error(`unknown language ${id}`);
    return L;
  }

  private nameRec(id: NameId): NameRec {
    const N = this.names[id];
    if (!N) throw new Error(`unknown name ${id}`);
    return N;
  }

  private path(id: number): LangRec[] {
    let p = this.pathCache.get(id);
    if (p) return p;
    const out: LangRec[] = [];
    let cur: LangRec | null = this.lang(id);
    while (cur) {
      out.push(cur);
      cur = cur.parent === null ? null : this.lang(cur.parent);
    }
    p = out.reverse();
    this.pathCache.set(id, p);
    return p;
  }

  private isDescOrSelf(m: number, x: number): boolean {
    for (const L of this.path(m)) if (L.id === x) return true;
    return false;
  }

  /** Does language m inherit (natively) a form that existed in language x at `year`?
   *  True when m is x, or descends from x through a split that happened at or after `year`. */
  private inherits(m: number, x: number, year: number): boolean {
    if (m === x) return true;
    const path = this.path(m);
    const i = path.findIndex((l) => l.id === x);
    if (i < 0) return false;
    return path[i + 1].born >= year;
  }

  private ancestorAt(m: number, year: number): LangRec {
    const path = this.path(m);
    let best = path[0];
    for (const L of path) if (L.born <= year) best = L;
    return best;
  }

  private clearDerivedCaches(): void {
    this.nameCache.clear();
    this.profileCache.clear();
    this.snapCache.clear();
  }

  /** Materialize sound changes and lexical replacements up to `year`. */
  private ensure(L: LangRec, year: number): void {
    if (year <= L.frontier || L.materializing) return;
    const cap = Math.min(year, L.died ?? Infinity);
    L.materializing = true;
    try {
      for (;;) {
        const nr = L.nextRule;
        const nl = L.nextLex;
        if (nr <= cap && nr <= nl) {
          this.materializeRule(L, nr);
          L.nextRule = nr + gap(L.ruleRng, RULE_GAP);
        } else if (nl <= cap) {
          this.materializeLex(L, nl);
          L.nextLex = nl + gap(L.lexRng, LEX_GAP);
        } else break;
      }
    } finally {
      L.materializing = false;
    }
    L.frontier = Math.max(L.frontier, year);
  }

  private materializeRule(L: LangRec, year: number): void {
    const inv = new Set<number>();
    for (const w of L.snap) for (const p of w) inv.add(p);
    const rng = new Rng(mixSeed(this.seed, 'rule', L.seedKey, year));
    const spec = proposeRule({ inv, rng, style: L.style, lex: L.snap }, L.labels);
    if (!spec) return;
    const uid = `${L.id}.${L.rules.length}`;
    L.rules.push({ year, spec, uid, lang: L.id });
    L.snap = L.snap.map((w) => applyRule(spec, w));
    for (const p of ruleOutputs(spec)) L.symInv.add(p);
    L.labels.set(spec.label, (L.labels.get(spec.label) ?? 0) + 1);
    // profile/snapshot caches are keyed by the last applicable rule, so new rules need no invalidation
  }

  private materializeLex(L: LangRec, year: number): void {
    const rng = new Rng(mixSeed(this.seed, 'lexev', L.seedKey, year));
    const k = rng.int(2, 5);
    const pool = CONCEPTS.filter((c) => c.pos !== 'num');
    const weights = pool.map((c) => (c.core ? 0.12 : 1));
    for (let i = 0; i < k; i++) {
      const c = rng.weighted(pool, weights);
      const syl = c.core ? L.style.sylCore : L.style.sylOther;
      const n = rng.weighted(syl.map((s) => s[0]), syl.map((s) => s[1]));
      const raw = genRoot(L.pp, rng, n);
      // bring the new coinage to the language's current shape (rules < year, without re-entering ensure)
      const form = this.evolveRaw(raw, L.root, this.lang(L.root).born, L.id, year - 1);
      L.lex.push({ year, concept: c.id, form });
    }
  }

  /** Rules along the lineage path from language x (after year y) to m (up to year t). */
  private applicableRules(x: number, y: number, m: number, t: number, raw = false): MatRule[] {
    const path = this.path(m);
    const start = path.findIndex((l) => l.id === x);
    if (start < 0) throw new Error(`language ${x} is not an ancestor of ${m}`);
    const out: MatRule[] = [];
    for (let i = start; i < path.length; i++) {
      const L = path[i];
      const hi = i + 1 < path.length ? path[i + 1].born : Infinity;
      const upper = Math.min(hi, t);
      if (!raw) this.ensure(L, upper);
      for (const r of L.rules) if (r.year > y && r.year <= upper) out.push(r);
    }
    return out;
  }

  private evolveWith(form: number[], rules: MatRule[]): number[] {
    if (!rules.length) return form;
    const k = `${rules[0].uid}|${rules[rules.length - 1].uid}|${rules.length}`;
    let m = this.evolveCache.get(form);
    if (!m) {
      m = new Map();
      this.evolveCache.set(form, m);
    }
    const hit = m.get(k);
    if (hit) return hit;
    let w = form;
    for (const r of rules) w = applyRule(r.spec, w);
    m.set(k, w);
    return w;
  }

  private evolve(form: number[], x: number, y: number, m: number, t: number): number[] {
    return this.evolveWith(form, this.applicableRules(x, y, m, t));
  }

  private evolveRaw(form: number[], x: number, y: number, m: number, t: number): number[] {
    return this.evolveWith(form, this.applicableRules(x, y, m, t, true));
  }

  private freshRoot(L: LangRec, year: number, nSyl: number, rng: Rng): number[] {
    const raw = genRoot(L.pp, rng, Math.max(1, nSyl));
    return this.evolve(raw, L.root, this.lang(L.root).born, L.id, year);
  }

  /** Where a concept's current word in language m comes from: proto root or a later replacement. */
  private wordOrigin(m: number, concept: Concept, t: number): { form: number[]; x: number; y: number } {
    const path = this.path(m);
    const root = path[0];
    const proto = root.protoLex.get(concept);
    if (!proto) throw new Error(`unknown concept ${concept}`);
    let best = { form: proto, x: root.id, y: root.born };
    for (let i = 0; i < path.length; i++) {
      const L = path[i];
      const hi = i + 1 < path.length ? path[i + 1].born : Infinity;
      const upper = Math.min(hi, t);
      this.ensure(L, upper);
      for (const r of L.lex) if (r.concept === concept && r.year <= upper && r.year >= best.y) best = { form: r.form, x: L.id, y: r.year };
    }
    return best;
  }

  private wordForm(m: number, concept: Concept, t: number): number[] {
    const o = this.wordOrigin(m, concept, t);
    return this.evolve(o.form, o.x, o.y, m, t);
  }

  private snapshotAt(m: number, t: number): number[][] {
    const rules = this.applicableRules(this.lang(m).root, -Infinity, m, t);
    const k = `${m}|${rules.length ? rules[rules.length - 1].uid : '-'}|${rules.length}`;
    const hit = this.snapCache.get(k);
    if (hit) return hit;
    const root = this.lang(this.lang(m).root);
    const snap = [...root.protoLex.values()].map((w) => this.evolveWith(w, rules));
    this.snapCache.set(k, snap);
    return snap;
  }

  private recomputeSnap(L: LangRec): number[][] {
    const rules = this.applicableRules(L.root, -Infinity, L.id, L.died ?? L.frontier, true);
    const root = this.lang(L.root);
    return [...root.protoLex.values()].map((w) => {
      let x = w;
      for (const r of rules) x = applyRule(r.spec, x);
      return x;
    });
  }

  private profileAt(m: number, t: number): Profile {
    const rules = this.applicableRules(this.lang(m).root, -Infinity, m, t);
    const k = `${m}|${rules.length ? rules[rules.length - 1].uid : '-'}|${rules.length}`;
    let p = this.profileCache.get(k);
    if (!p) {
      p = profileOf(this.snapshotAt(m, t), this.lang(m).style.epenthetic);
      this.profileCache.set(k, p);
    }
    return p;
  }

  private contactYear(m: number, src: number): number {
    const ck = `${m}|${src}`;
    const hit = this.contactCache.get(ck);
    if (hit !== undefined) return hit;
    const mSide = this.path(m).map((l) => l.id);
    const sSide = new Set<number>(this.path(src).map((l) => l.id));
    const stack = [src];
    while (stack.length) {
      const c = stack.pop()!;
      sSide.add(c);
      for (const ch of this.lang(c).children) stack.push(ch);
    }
    let best = Infinity;
    for (const a of mSide) {
      for (const b of sSide) {
        if (a === b) continue;
        const y = this.contacts.get(a < b ? `${a}|${b}` : `${b}|${a}`);
        if (y !== undefined && y < best) best = y;
      }
    }
    this.contactCache.set(ck, best);
    return best;
  }

  private adaptSegs(segs: number[][], target: number, year: number): number[][] {
    const prof = this.profileAt(target, year);
    return segs.map((s) => adaptTo(s, prof));
  }

  /** The segments of name `id` as used by speakers of `m` at year `t`. */
  private nameSegs(id: NameId, m: number, t: number, limit?: number): { segs: number[][]; joiner: '' | '-' | ' ' } {
    const N = this.nameRec(id);
    const lim = limit ?? N.chain.length;
    const ck = `${m}|${t}|${lim}`;
    let cache = this.nameCache.get(id);
    if (!cache) {
      cache = new Map();
      this.nameCache.set(id, cache);
    }
    const hit = cache.get(ck);
    if (hit) return hit;
    const result = this.computeNameSegs(N, m, t, lim);
    cache.set(ck, result);
    return result;
  }

  private computeNameSegs(N: NameRec, m: number, t: number, lim: number): { segs: number[][]; joiner: '' | '-' | ' ' } {
    const chain = N.chain.slice(0, lim);
    let entries = chain.filter((e) => e.year <= t);
    if (!entries.length) entries = [chain[0]];
    const joiner = N.joiner;
    for (let k = 0; k < entries.length; k++) {
      const e = entries[k];
      const nextYear = k + 1 < entries.length ? entries[k + 1].year : Infinity;
      if (this.inherits(m, e.lang, e.year)) {
        let base: number[][];
        if (k === 0) base = N.segs;
        else {
          const prev = this.nameSegs(N.id, entries[k - 1].lang, e.year, k);
          base = this.adaptSegs(prev.segs, e.lang, e.year);
        }
        return { segs: base.map((s) => this.evolve(s, e.lang, e.year, m, Math.max(t, e.year))), joiner };
      }
      const c = this.contactYear(m, e.lang);
      const b = Math.max(e.year, c);
      if (b <= t && b < nextYear) {
        return this.borrowed(N, e.lang, k + 1, m, b, t);
      }
    }
    const last = entries[entries.length - 1];
    return this.borrowed(N, last.lang, entries.length, m, Math.max(t, last.year), t);
  }

  private borrowed(N: NameRec, srcLang: number, lim: number, m: number, b: number, t: number): { segs: number[][]; joiner: '' | '-' | ' ' } {
    const src = this.nameSegs(N.id, srcLang, b, lim);
    const A = this.ancestorAt(m, b);
    const bb = Math.max(b, A.born);
    const adapted = this.adaptSegs(src.segs, A.id, bb);
    return { segs: adapted.map((s) => this.evolve(s, A.id, bb, m, Math.max(t, bb))), joiner: src.joiner };
  }

  // ------------------------------------------------------------ inflection

  private affixAt(L: LangRec, k: string, x: number, y: number): { pos: 'pre' | 'suf'; form: number[] } | null {
    const a = L.morph.affixes[k];
    if (!a) return null;
    return { pos: a.pos, form: this.evolve(a.form, L.root, this.lang(L.root).born, x, y) };
  }

  private particle(L: LangRec, k: string, t: number): number[] | null {
    const f = L.morph.particles[k];
    if (!f) return null;
    return this.evolve(f, L.root, this.lang(L.root).born, L.id, t);
  }

  /** Inflected concept word with progressive segmentation for glossing. */
  private inflectConcept(L: LangRec, t: number, concept: Concept, keys: string[]): Piece[] {
    const o = this.wordOrigin(L.id, concept, t);
    const ep = this.profileAt(o.x, o.y).epenthetic;
    const stemGloss = conceptDef(concept).en.replace(/ /g, '.');
    let composed = o.form;
    let prevReal = this.evolve(composed, o.x, o.y, L.id, t);
    let pieces: Piece[] = [{ ph: prevReal, gloss: stemGloss, stem: true }];
    for (const k of keys) {
      const a = this.affixAt(L, k, o.x, o.y);
      if (!a) continue;
      composed = a.pos === 'pre' ? join(a.form, composed, ep) : join(composed, a.form, ep);
      const real = this.evolve(composed, o.x, o.y, L.id, t);
      pieces = segmentStep(pieces, prevReal, real, a.pos, k);
      prevReal = real;
    }
    return pieces;
  }

  private nameTok(L: LangRec, t: number, id: NameId, keys: string[], resolveName: (n: NameId) => string): ITok {
    const { segs, joiner } = this.nameSegs(id, L.id, t);
    const ep = this.profileAt(L.id, t).epenthetic;
    const gloss = resolveName(id);
    const nameP: Piece[] = segs.map((s, i) => ({ ph: s, gloss: i === 0 ? gloss : '', stem: true }));
    let pieces = nameP.slice();
    for (const k of keys) {
      const a = this.affixAt(L, k, L.id, t);
      if (!a) continue;
      if (a.pos === 'suf') {
        const last = pieces[pieces.length - 1];
        const joined = join(last.ph, a.form, ep);
        if (startsWith(joined, last.ph) && joined.length > last.ph.length) pieces.push({ ph: joined.slice(last.ph.length), gloss: k, stem: false });
        else pieces[pieces.length - 1] = { ph: joined, gloss: (last.gloss ? last.gloss : '') + '.' + k, stem: true };
      } else {
        const first = pieces[0];
        const joined = join(a.form, first.ph, ep);
        if (endsWith(joined, first.ph) && joined.length > first.ph.length) pieces.unshift({ ph: joined.slice(0, joined.length - first.ph.length), gloss: k, stem: false });
        else pieces[0] = { ph: joined, gloss: k + '.' + first.gloss, stem: true };
      }
    }
    return { pieces, isName: true, nameSegCount: segs.length, joiner };
  }

  private conceptTok(L: LangRec, t: number, concept: Concept, keys: string[]): ITok {
    return { pieces: this.inflectConcept(L, t, concept, keys), isName: false, nameSegCount: 0, joiner: '', concept };
  }

  private particleTok(L: LangRec, t: number, k: string, gloss: string): ITok | null {
    const f = this.particle(L, k, t);
    if (!f) return null;
    return { pieces: [{ ph: f, gloss, stem: true }], isName: false, nameSegCount: 0, joiner: '', particle: true };
  }

  private npTokens(L: LangRec, t: number, np: NounPhrase, role: string | null, resolveName: (n: NameId) => string, inApposition = false): ITok[] {
    const morph = L.morph;
    let caseKey: string | null = null;
    let adpKey: string | null = null;
    if (role === 'object') caseKey = morph.cases.includes('ACC') ? 'ACC' : null;
    else if (role === 'GEN') {
      if (morph.cases.includes('GEN')) caseKey = 'GEN';
      else adpKey = 'ADP.GEN';
    } else if (role && ROLE_CASE[role]) {
      const [c, adp] = ROLE_CASE[role];
      if (morph.cases.includes(c) && !(role === 'benefactive' && L.style.caseSystem === 'semitic')) caseKey = c;
      else {
        adpKey = adp;
        if (L.style.caseSystem === 'semitic') caseKey = 'GEN'; // prepositions govern the genitive
      }
    }
    const keys: string[] = [];
    const isName = 'name' in np.head;
    if (!isName && (np.plural || (np.count !== undefined && np.count > 1)) && !conceptDef((np.head as { concept: Concept }).concept).mass) keys.push('PL');
    let possParticle: ITok | null = null;
    if (np.possessorPronoun) {
      const pk = 'POSS.' + np.possessorPronoun.toUpperCase();
      if (morph.affixes[pk]) keys.push(pk);
      else possParticle = this.particleTok(L, t, pk, pk.replace('POSS.', '') + '.POSS');
    }
    if (caseKey) keys.push(caseKey);
    const head: ITok = 'name' in np.head ? this.nameTok(L, t, np.head.name, keys, resolveName) : this.conceptTok(L, t, np.head.concept, keys);
    if (np.determinative) head.det = np.determinative;
    const before: ITok[] = [];
    const after: ITok[] = [];
    if (np.count !== undefined) {
      before.push({ pieces: [{ ph: [], gloss: String(np.count), stem: true }], isName: false, nameSegCount: 0, joiner: '', numeral: np.count });
    }
    for (const a of np.adjectives ?? []) {
      const tok = this.conceptTok(L, t, a, []);
      (morph.adjOrder === 'pre' ? before : after).push(tok);
    }
    if (np.demonstrative) {
      const d = this.particleTok(L, t, 'DEM', 'DEM');
      if (d) (morph.adjOrder === 'pre' ? before : after).push(d);
    }
    if (possParticle) (morph.genOrder === 'pre' ? before : after).push(possParticle);
    if (np.possessor) {
      const pt = this.npTokens(L, t, np.possessor, 'GEN', resolveName);
      (morph.genOrder === 'pre' ? before : after).push(...pt);
    }
    let out = [...before, head, ...after];
    for (const ap of np.apposition ?? []) out.push(...this.npTokens(L, t, ap, role, resolveName, true));
    if (adpKey && !inApposition) {
      const adp = this.particleTok(L, t, adpKey, ADP_GLOSS[adpKey]);
      if (adp) out = morph.adposition === 'pre' ? [adp, ...out] : [...out, adp];
    }
    return out;
  }

  private clauseTokens(L: LangRec, t: number, c: Clause, resolveName: (n: NameId) => string): ITok[] {
    const S = c.subject ? this.npTokens(L, t, c.subject, null, resolveName) : [];
    const O = c.object ? this.npTokens(L, t, c.object, 'object', resolveName) : [];
    const X: ITok[] = [];
    for (const o of c.obliques ?? []) X.push(...this.npTokens(L, t, o.np, o.role, resolveName));
    const tam = { past: 'PST', present: 'PRS', future: 'FUT', optative: 'OPT' }[c.mood];
    const V: ITok[] = [];
    if (c.negated) {
      const n = this.particleTok(L, t, 'NEG', 'NEG');
      if (n) V.push(n);
    }
    if (L.morph.affixes[tam]) V.push(this.conceptTok(L, t, c.verb, [tam]));
    else {
      const p = this.particleTok(L, t, tam, tam);
      if (p) V.push(p);
      V.push(this.conceptTok(L, t, c.verb, []));
    }
    switch (L.morph.order) {
      case 'SOV': return [...S, ...X, ...O, ...V];
      case 'SVO': return [...S, ...V, ...O, ...X];
      case 'VSO': return [...V, ...S, ...O, ...X];
    }
  }

  private tokenOut(t: ITok, resolveName: (n: NameId) => string): Token {
    void resolveName;
    if (t.numeral !== undefined) return { normalized: String(t.numeral), segmented: String(t.numeral), gloss: String(t.numeral) };
    let normalized: string;
    let segmented: string;
    if (t.isName) {
      const firstStem = Math.max(0, t.pieces.findIndex((p) => p.stem));
      let lastStem = firstStem;
      t.pieces.forEach((p, i) => { if (p.stem) lastStem = i; });
      const pre = t.pieces.slice(0, firstStem).map((p) => scholarly(p.ph, false));
      const names = t.pieces.slice(firstStem, lastStem + 1).map((p, i) => scholarly(p.ph, i === 0 || t.joiner === ' '));
      const suf = t.pieces.slice(lastStem + 1).map((p) => scholarly(p.ph, false));
      const nameJoined = names.join(t.joiner);
      normalized = pre.join('') + nameJoined + suf.join('');
      segmented = [...pre, nameJoined, ...suf].join('-');
    } else {
      const parts = t.pieces.map((p) => scholarly(p.ph, false));
      normalized = parts.join('');
      segmented = parts.join('-');
    }
    const gloss = t.pieces.filter((p) => p.gloss !== '').map((p) => p.gloss).join('-');
    return { normalized, segmented, gloss };
  }

  private logogram(L: LangRec, concept: Concept, script: { kind: ScriptKind; originLang: LangId }, t: number, stemPh: number[]): string {
    if (script.originLang !== L.id && !this.isDescOrSelf(L.id, script.originLang)) {
      const O = this.lang(script.originLang);
      const yr = Math.min(t, O.died ?? t);
      return scholarly(this.wordForm(O.id, concept, Math.max(yr, O.born)), false).toUpperCase();
    }
    return scholarly(stemPh, false);
  }

  private transliterate(toks: ITok[], script: { kind: ScriptKind; originLang: LangId }, L: LangRec, t: number): string {
    const kind = script.kind;
    if (kind === 'alphabet') {
      return toks.map((tk) => (tk.numeral !== undefined ? String(tk.numeral) : tk.pieces.map((p) => scholarly(p.ph, false)).join('').toUpperCase())).join('·');
    }
    const words = toks.map((tk) => {
      if (tk.numeral !== undefined) return String(tk.numeral);
      const whole = ([] as number[]).concat(...tk.pieces.map((p) => p.ph));
      if (kind === 'abjad') return abjadSpelling(whole);
      const det = tk.det ? DETERMINATIVES[tk.det] : undefined;
      const wrap = (s: string) => (det?.pre ?? '') + s + (det?.post ?? '');
      if (tk.isName) {
        const nameSegs = tk.pieces.filter((p) => p.stem).map((p) => syllabicSpelling(p.ph));
        const affix = tk.pieces.filter((p) => !p.stem).map((p) => syllabicSpelling(p.ph));
        return wrap([...nameSegs, ...affix].join('-'));
      }
      if (kind === 'syllabary' || tk.particle || !tk.concept) return wrap(syllabicSpelling(whole));
      const d = conceptDef(tk.concept);
      const useLogo = kind === 'logographic' ? d.pos !== 'num' : LOGOGRAM_CONCEPTS.has(tk.concept);
      const stemIdx = tk.pieces.findIndex((p) => p.stem);
      if (!useLogo || stemIdx < 0) return wrap(syllabicSpelling(whole));
      const stem = tk.pieces[stemIdx];
      const logo = this.logogram(L, tk.concept, script, t, stem.ph);
      const pre = tk.pieces.slice(0, stemIdx).filter((p) => p.ph.length).map((p) => syllabicSpelling(p.ph));
      const suf = tk.pieces.slice(stemIdx + 1).filter((p) => p.ph.length).map((p) => syllabicSpelling(p.ph));
      return wrap([...pre, logo, ...suf].join('-'));
    });
    return words.join(kind === 'abjad' ? ' · ' : ' ');
  }
}

function startsWith(a: number[], b: number[]): boolean {
  if (b.length > a.length) return false;
  for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
function endsWith(a: number[], b: number[]): boolean {
  if (b.length > a.length) return false;
  const off = a.length - b.length;
  for (let i = 0; i < b.length; i++) if (a[off + i] !== b[i]) return false;
  return true;
}

/** Add one affix to a segmented word, falling back to portmanteau glosses when fused. */
function segmentStep(pieces: Piece[], prev: number[], real: number[], pos: 'pre' | 'suf', label: string): Piece[] {
  if (pos === 'suf') {
    if (startsWith(real, prev)) {
      const rest = real.slice(prev.length);
      if (rest.length === 0) {
        const out = pieces.slice();
        const last = out[out.length - 1];
        out[out.length - 1] = { ...last, gloss: last.gloss + '.' + label };
        return out;
      }
      return [...pieces, { ph: rest, gloss: label, stem: false }];
    }
  } else if (endsWith(real, prev)) {
    const rest = real.slice(0, real.length - prev.length);
    if (rest.length === 0) {
      const out = pieces.slice();
      out[0] = { ...out[0], gloss: label + '.' + out[0].gloss };
      return out;
    }
    return [{ ph: rest, gloss: label, stem: false }, ...pieces];
  }
  // fused: collapse everything into one piece
  const gl = pos === 'suf' ? pieces.map((p) => p.gloss).join('.') + '.' + label : label + '.' + pieces.map((p) => p.gloss).join('.');
  return [{ ph: real, gloss: gl, stem: true }];
}

// keep unused-import linting quiet for helpers re-exported for tests
void PHONS; void P; void hasSym; void STYLE_BY_ID; void CONCEPT_INDEX;
