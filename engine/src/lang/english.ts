// English free translation, generated from the same clause structures as the original text.

import { conceptDef } from './concepts.ts';
import type { Clause, NounPhrase, NameId } from './types.ts';

const POSS_EN: Record<string, string> = { '1sg': 'my', '3sg.m': 'his', '3sg.f': 'her', '3pl': 'their' };
const PREP: Record<string, string> = {
  dative: 'to', benefactive: 'for', locative: 'in', instrumental: 'with', ablative: 'from', comitative: 'together with',
};

export function pluralize(id: string): string {
  const d = conceptDef(id);
  if (d.plural) return d.plural;
  const w = d.en;
  if (/(s|sh|ch|x|z)$/.test(w)) return w + 'es';
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies';
  return w + 's';
}

function pastOf(id: string): string {
  const d = conceptDef(id);
  if (d.past) return d.past;
  return d.en.endsWith('e') ? d.en + 'd' : d.en + 'ed';
}

function thirdSg(id: string): string {
  const w = conceptDef(id).en;
  if (w === 'have') return 'has';
  if (/(s|sh|ch|x|z|o)$/.test(w)) return w + 'es';
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies';
  return w + 's';
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

export function npEnglish(np: NounPhrase, resolveName: (n: NameId) => string, inApposition = false): string {
  const isName = 'name' in np.head;
  const adjs = (np.adjectives ?? []).map((c) => conceptDef(c).en);
  let core: string;
  if ('name' in np.head) {
    core = [...adjs, resolveName(np.head.name)].join(' ');
  } else {
    const d = conceptDef(np.head.concept);
    const plural = !!np.plural || (np.count !== undefined && np.count !== 1);
    const noun = plural && !d.mass ? pluralize(d.id) : d.en;
    let det = '';
    if (np.count !== undefined) det = formatCount(np.count);
    else if (np.demonstrative) det = plural ? 'these' : 'this';
    else if (np.possessorPronoun) det = POSS_EN[np.possessorPronoun];
    else if (inApposition && d.title) det = '';
    else if (d.mass && !np.possessor) det = '';
    else det = 'the';
    if (np.count !== undefined && np.possessorPronoun) det = POSS_EN[np.possessorPronoun] + ' ' + det;
    core = [det, ...adjs, noun].filter(Boolean).join(' ');
  }
  if (np.possessor) {
    const pd = 'concept' in np.possessor.head ? conceptDef(np.possessor.head.concept) : null;
    // "3,000 talents of silver": mass possessor of a counted unit reads without article
    const massOf = pd && pd.mass && !np.possessor.possessor;
    core += ' of ' + (massOf ? npEnglishBare(np.possessor, resolveName) : npEnglish(np.possessor, resolveName, isName));
  }
  if (np.apposition && np.apposition.length) {
    core += ', ' + np.apposition.map((a) => npEnglish(a, resolveName, true)).join(', ');
  }
  return core;
}

function npEnglishBare(np: NounPhrase, resolveName: (n: NameId) => string): string {
  const adjs = (np.adjectives ?? []).map((c) => conceptDef(c).en);
  if ('name' in np.head) return [...adjs, resolveName(np.head.name)].join(' ');
  return [...adjs, conceptDef(np.head.concept).en].join(' ');
}

function subjectPlural(np?: NounPhrase): boolean {
  if (!np) return false;
  return !!np.plural || (np.count !== undefined && np.count !== 1);
}

export function clauseEnglish(c: Clause, resolveName: (n: NameId) => string): string {
  const subj = c.subject ? npEnglish(c.subject, resolveName) : '';
  const subjHasAppos = !!c.subject?.apposition?.length;
  const base = conceptDef(c.verb).en;
  let verb: string;
  switch (c.mood) {
    case 'past':
      verb = c.negated ? `did not ${base}` : pastOf(c.verb);
      break;
    case 'present':
      verb = c.negated ? (subjectPlural(c.subject) ? `do not ${base}` : `does not ${base}`) : subjectPlural(c.subject) ? base : thirdSg(c.verb);
      break;
    case 'future':
      verb = c.negated ? `will not ${base}` : `will ${base}`;
      break;
    case 'optative':
      verb = c.negated ? `not ${base}` : base;
      break;
  }
  const rest: string[] = [];
  if (c.object) rest.push(npEnglish(c.object, resolveName));
  for (const o of c.obliques ?? []) rest.push(`${PREP[o.role]} ${npEnglish(o.np, resolveName)}`);
  let s: string;
  if (c.mood === 'optative') {
    s = `may ${subj || 'they'}${subjHasAppos ? ',' : ''} ${verb}`;
  } else {
    s = `${subj || 'he'}${subjHasAppos ? ',' : ''} ${verb}`;
  }
  if (rest.length) s += ' ' + rest.join(' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

export function translate(clauses: Clause[], resolveName: (n: NameId) => string): string {
  return clauses.map((c) => clauseEnglish(c, resolveName)).join(' ');
}
