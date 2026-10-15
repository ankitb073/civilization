// The shared meaning inventory. Every language has a word for each concept; names are
// coined from these; inscriptions are composed of them.

export type Concept = string;

export interface ConceptDef {
  id: Concept;
  en: string;               // English lemma (noun singular, verb base, adjective)
  pos: 'n' | 'v' | 'adj' | 'num';
  past?: string;            // irregular English past tense
  plural?: string;          // irregular English plural
  mass?: boolean;           // no article / no plural ("silver", "barley")
  core?: boolean;           // basic vocabulary: shorter roots, rarely replaced
  title?: boolean;          // rendered without article in apposition ("great king")
  value?: number;           // numerals
}

const n = (id: string, extra: Partial<ConceptDef> = {}): ConceptDef => ({ id, en: id.replace(/-/g, ' '), pos: 'n', ...extra });
const v = (id: string, past?: string, extra: Partial<ConceptDef> = {}): ConceptDef => ({ id, en: id.replace(/-/g, ' '), pos: 'v', past, ...extra });
const a = (id: string, extra: Partial<ConceptDef> = {}): ConceptDef => ({ id, en: id.replace(/-/g, ' '), pos: 'adj', ...extra });

export const CONCEPTS: ConceptDef[] = [
  // nature
  n('sun', { core: true }), n('moon', { core: true }), n('star', { core: true }), n('sky', { core: true }),
  n('cloud'), n('storm'), n('thunder'), n('rain', { core: true, mass: true }), n('river', { core: true }),
  n('water', { core: true, mass: true }), n('sea', { core: true }), n('lake'), n('spring'), n('mountain', { core: true }),
  n('hill'), n('valley'), n('plain'), n('forest'), n('tree', { core: true }), n('stone', { core: true }), n('rock'),
  n('field'), n('grain', { mass: true }), n('barley', { mass: true }), n('earth', { core: true, mass: true }),
  n('sand', { mass: true }), n('fire', { core: true }), n('wind', { core: true }), n('snow', { mass: true }),
  n('ice', { mass: true }), n('salt', { mass: true }), n('horse', { core: true }), n('bull'), n('cow'),
  n('sheep', { plural: 'sheep' }), n('goat'), n('dog', { core: true }), n('wolf', { plural: 'wolves' }), n('bear'),
  n('lion'), n('eagle'), n('raven'), n('snake'), n('fish', { core: true, plural: 'fish' }), n('bird', { core: true }),
  n('deer', { plural: 'deer' }), n('reed'), n('flower'), n('island'), n('coast'), n('marsh'), n('desert'),
  n('steppe'), n('ford'), n('mouth'), n('bay'), n('dawn'), n('night', { core: true }), n('day', { core: true }),
  n('year'), n('season'), n('harvest'), n('flood'), n('drought'), n('ash', { mass: true }), n('smoke', { mass: true }),
  n('blood', { core: true, mass: true }), n('bone', { core: true }), n('head', { core: true }), n('hand', { core: true }),
  n('eye', { core: true }), n('heart', { core: true }), n('milk', { mass: true }), n('honey', { mass: true }),
  n('bread', { mass: true }), n('meat', { mass: true }), n('oak'), n('cedar'),
  // people
  n('man', { core: true, plural: 'men' }), n('woman', { core: true, plural: 'women' }),
  n('father', { core: true, title: true }), n('mother', { core: true, title: true }),
  n('son', { core: true, title: true }), n('daughter', { title: true }), n('brother', { title: true }),
  n('sister', { title: true }), n('people', { plural: 'peoples' }), n('child', { plural: 'children' }),
  n('slave'), n('servant', { title: true }), n('merchant', { title: true }), n('scribe', { title: true }),
  n('priest', { title: true }), n('priestess', { title: true }), n('prophet', { title: true }), n('soldier'),
  n('warrior'), n('enemy', { plural: 'enemies' }), n('friend'), n('stranger'), n('elder', { title: true }),
  n('hero', { plural: 'heroes', title: true }), n('shepherd'), n('farmer'), n('smith'), n('sailor'),
  n('envoy', { title: true }), n('guest'), n('ancestor'),
  // power
  n('king', { core: true, title: true }), n('great-king', { title: true }), n('queen', { title: true }),
  n('lord', { title: true }), n('lady', { title: true, plural: 'ladies' }), n('chief', { title: true }),
  n('prince', { title: true }), n('princess', { title: true, plural: 'princesses' }), n('governor', { title: true }),
  n('council'), n('assembly', { plural: 'assemblies' }), n('law'), n('judge', { title: true }),
  n('tribute', { mass: true }), n('treaty', { plural: 'treaties' }), n('oath'), n('peace', { mass: true }), n('war'),
  n('army', { plural: 'armies' }), n('battle'), n('victory', { plural: 'victories' }), n('border'),
  n('boundary-stone'), n('throne'), n('crown'), n('realm'), n('land'), n('province'), n('tax', { plural: 'taxes' }),
  n('decree'), n('seal'), n('hostage'), n('ally', { plural: 'allies', title: true }), n('rebel'),
  n('heir', { title: true }), n('dynasty', { plural: 'dynasties' }), n('empire'), n('freedom', { mass: true }),
  n('justice', { mass: true }), n('order'), n('power', { mass: true }), n('glory', { mass: true }), n('fame', { mass: true }),
  n('shield'), n('sword'), n('spear'), n('bow'), n('chariot'), n('banner'), n('fortress', { plural: 'fortresses' }),
  n('tower'),
  // built things and goods
  n('city', { core: true, plural: 'cities' }), n('town'), n('village'), n('wall'), n('gate'), n('house', { core: true }),
  n('temple'), n('palace'), n('tomb'), n('stele'), n('road'), n('bridge'), n('market'), n('harbor'), n('granary', { plural: 'granaries' }),
  n('well'), n('gold', { mass: true }), n('silver', { mass: true }), n('copper', { mass: true }), n('tin', { mass: true }),
  n('bronze', { mass: true }), n('iron', { mass: true }), n('lead', { mass: true }), n('coin'), n('cloth', { mass: true }),
  n('wool', { mass: true }), n('wine', { mass: true }), n('oil', { mass: true }), n('spice', { mass: true }),
  n('incense', { mass: true }), n('timber', { mass: true }), n('coal', { mass: true }), n('steam', { mass: true }),
  n('engine'), n('rail'), n('wire'), n('machine'), n('ship'), n('boat'), n('cart'), n('wheel'), n('talent'),
  n('measure'), n('jar'), n('tablet'), n('ink', { mass: true }), n('paper', { mass: true }), n('letter'), n('gift'),
  n('price'), n('debt'), n('loan'), n('profit'), n('commerce', { mass: true }), n('bank'), n('factory', { plural: 'factories' }),
  // religion and thought
  n('god', { title: true }), n('goddess', { title: true, plural: 'goddesses' }), n('spirit'), n('heaven'),
  n('underworld'), n('name', { core: true }), n('truth', { mass: true }), n('wisdom', { mass: true }), n('path'),
  n('light', { mass: true }), n('darkness', { mass: true }), n('soul'), n('death', { core: true }), n('life', { core: true, plural: 'lives' }),
  n('word', { core: true }), n('book'), n('prayer'), n('sacrifice'), n('altar'), n('sin'), n('mercy', { mass: true }),
  n('fate'), n('dream'), n('omen'), n('teacher', { title: true }), n('student'), n('school'), n('reason', { mass: true }),
  n('faith', { mass: true }), n('sign'), n('song'), n('story', { plural: 'stories' }), n('memory', { plural: 'memories' }),
  // adjectives
  a('great', { core: true }), a('small', { core: true }), a('new', { core: true }), a('old', { core: true }), a('high'),
  a('low'), a('white', { core: true }), a('black', { core: true }), a('red', { core: true }), a('green'), a('blue'),
  a('golden'), a('holy'), a('strong'), a('just'), a('eternal'), a('first'), a('last'), a('far'), a('near'), a('rich'),
  a('poor'), a('wise'), a('brave'), a('beautiful'), a('good', { core: true }), a('evil'), a('true'), a('free'),
  a('young'), a('bright'), a('dark'), a('wide'), a('long', { core: true }), a('deep'), a('cold'), a('hot'),
  a('sweet'), a('bitter'), a('pure'), a('swift'), a('silent'),
  // verbs
  v('build', 'built'), v('give', 'gave', { core: true }), v('take', 'took'), v('swear', 'swore'), v('rule', 'ruled'),
  v('conquer', 'conquered'), v('destroy', 'destroyed'), v('defeat', 'defeated'), v('burn', 'burned'), v('flee', 'fled'),
  v('return', 'returned'), v('trade', 'traded'), v('pay', 'paid'), v('buy', 'bought'), v('sell', 'sold'),
  v('write', 'wrote'), v('speak', 'spoke'), v('say', 'said', { core: true }), v('hear', 'heard', { core: true }),
  v('see', 'saw', { core: true }), v('dwell', 'dwelt'), v('found', 'founded'), v('bless', 'blessed'),
  v('curse', 'cursed'), v('protect', 'protected'), v('erect', 'erected'), v('dedicate', 'dedicated'),
  v('restore', 'restored'), v('cede', 'ceded'), v('die', 'died', { core: true }), v('live', 'lived', { core: true }),
  v('love', 'loved'), v('fear', 'feared'), v('know', 'knew', { core: true }), v('come', 'came', { core: true }),
  v('go', 'went'), v('make', 'made'), v('send', 'sent'), v('receive', 'received'), v('bring', 'brought'),
  v('lead', 'led'), v('fight', 'fought'), v('win', 'won'), v('lose', 'lost'), v('kill', 'killed'),
  v('capture', 'captured'), v('besiege', 'besieged'), v('plunder', 'plundered'), v('march', 'marched'),
  v('sail', 'sailed'), v('rise', 'rose'), v('fall', 'fell'), v('grant', 'granted'), v('command', 'commanded'),
  v('offer', 'offered'), v('pray', 'prayed'), v('praise', 'praised'), v('honor', 'honored'),
  v('remember', 'remembered'), v('forget', 'forgot'), v('open', 'opened'), v('close', 'closed'),
  v('carve', 'carved'), v('inscribe', 'inscribed'), v('raise', 'raised'), v('break', 'broke'), v('keep', 'kept'),
  v('hold', 'held'), v('serve', 'served'), v('obey', 'obeyed'), v('betray', 'betrayed'), v('liberate', 'liberated'),
  v('marry', 'married'), v('grow', 'grew'), v('eat', 'ate', { core: true }), v('drink', 'drank', { core: true }),
  v('sleep', 'slept', { core: true }), v('count', 'counted'), v('weigh', 'weighed'), v('owe', 'owed'),
  v('lend', 'lent'), v('borrow', 'borrowed'),
  // numerals
  ...(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'] as const).map(
    (w, i): ConceptDef => ({ id: w, en: w, pos: 'num', core: true, value: i + 1 }),
  ),
  { id: 'hundred', en: 'hundred', pos: 'num', core: true, value: 100 },
  { id: 'thousand', en: 'thousand', pos: 'num', core: true, value: 1000 },
];

export const CONCEPT_INDEX: Map<Concept, ConceptDef> = new Map(CONCEPTS.map((c) => [c.id, c]));

export function conceptDef(id: Concept): ConceptDef {
  const c = CONCEPT_INDEX.get(id);
  if (!c) throw new Error(`unknown concept: ${id}`);
  return c;
}

/** Concepts commonly written with logograms in logosyllabic scripts. */
export const LOGOGRAM_CONCEPTS: ReadonlySet<Concept> = new Set([
  'king', 'great-king', 'queen', 'lord', 'god', 'goddess', 'city', 'land', 'temple', 'palace', 'house', 'son',
  'daughter', 'silver', 'gold', 'copper', 'tin', 'bronze', 'iron', 'barley', 'grain', 'horse', 'sheep', 'bull',
  'river', 'sea', 'mountain', 'stele', 'ship', 'man', 'woman', 'servant', 'scribe', 'priest', 'army', 'year',
  'day', 'talent', 'measure', 'oil', 'wine', 'tablet', 'gate', 'wall', 'tribute', 'oath', 'treaty', 'god',
]);
