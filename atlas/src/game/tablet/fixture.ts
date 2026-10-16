// A development fixture: one scenario in the LLD's Scenario shape (played with the generic script), so the game can
// be built, played and screenshotted without scenarios.json or any scenario script. The figures are taken from the canonical
// record (seed 5: the sack of Wal'a, evt:2718, after the battle evt:2717); the chronicle entry is illustrative only.
// The game uses this only when data/scenarios.json cannot be loaded.
import type { Scenario } from './types.ts';

export const FIXTURE_SCENARIO: Scenario = {
  id: 'sc-2718',
  event: 2718,
  year: 637,
  city: { id: 'set:22', name: 'Wal’a', pop: 22429, cell: 2299, port: true },
  state: {
    id: 'pol:87', name: 'I’iti',
    ruler: { id: 'per:3016', name: 'Shim’am’igwi', sex: 'm', age: 23, title: 'king' },
    faith: 'Ya’cuam',
    gods: [{ name: 'Nili’i', sex: 'm', role: 'river' }, { name: 'Yubi', sex: 'f', role: 'fire' }, { name: 'Nish’il', sex: 'm', role: 'sky' }],
    coin: 'sazhon', grain: 0.42,
  },
  enemy: { id: 'pol:108', name: 'Wa’mi', ruler: { id: 'per:2954', name: 'Saskhama', sex: 'm' } },
  medium: 'clay tablet',
  script: 'Fwe’ni’üsa',
  battle: {
    id: 'evt:2717', place: 'Yimola', ours: 2227, theirs: 5427, oursLost: 695, theirsLost: 220, won: false,
    commander: { name: 'Nitllo Shimin', sex: 'm', isKing: false },
  },
  outcome: 'sacked',
  burnedArchives: true,
  treaty: null,
  hardship: { famine: true, plague: null, drought: false, grainBefore: 0.42, grainAfter: 1.65 },
  chronicle: {
    catalog: 'PAL·CH·00412', author: 'Yocua’igwi', year: 641, oursLost: 210, theirsLost: 1900,
    outcomeWords: 'the city was given to Yubi’s fire by the will of the gods',
    quote: 'The men of Wa’mi fell at Yimola like barley before the sickle, and of ours only a few. Then the gods turned their faces from Wal’a, and the city was given to Yubi’s fire.',
  },
  names: {
    f: ['Titl’a', 'Vish’itlu', 'A’il', 'I’cuil', 'Vish’inim', 'Yikhimi', 'Alimamshi', 'A’ma’igwi', 'Lashla’tlu', 'Nava'],
    m: ['Suzholmab', 'Isotlmi', 'Yubshim’am', 'Yisa', 'Oshsay’ash', 'Vas’agw', 'Shosh’a’igwi', 'Atli', 'Yocua’igwi', 'Khiyim', 'Losh’ayub'],
  },
  camera: null,
  eraIndex: 0,
  date: 'on the ninth day of the barley month',
};
