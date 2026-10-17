// Streets world: names the street layer gives places, from the archive's own texts about a scenario. The city model
// and the scenario export name the city, its river, its temple's faith, its palace's state and when its walls went
// up; they do not name gates or streets. Those come from the documents written about the siege (the "additions
// rule" in docs/streets/hld.md: add only what the record does not contradict and what the scripts or flagships need).
// Every other city gets plain descriptive names.

export interface StreetNames {
  /** The gate nearest the river (where a river runs). */
  riverGate: string;
  /** A second named gate (the land gate nearest the market). */
  marketGate: string | null;
  /** A small door in the walls where the sack came in (toward the sack's direction), and the quarter inside it. */
  postern: string | null;
  quarter: string | null;
  /** Other quarters named by the texts (laid out around the town, away from the postern). */
  streets: string[];
  tabletHouse: string;
  market: string;
  well: string;
  /** Where these names come from (for the record). */
  sources: string[];
}

const BY_SCENARIO: Record<string, StreetNames> = {
  // The Sack of Himi, Pumi AY 332. The eyewitness (fl-354, PAL·CH·08471, "The Burning of the House of Tablets at
  // Pumi"): "They came in at the river gate. They came in at the gate of the barley-merchants. I saw them in the
  // street of the potters. I saw them in the street of the weavers." The Tablet House script for sc-919: "a postern
  // on the dyers' side opens that should have stayed shut"; "the dyers' vats steaming in the next street"; "the
  // weigher's scale"; "the cistern in the courtyard". Its "canal gate" is, in the model, the river gate.
  'sc-919': {
    riverGate: 'The river gate',
    marketGate: 'The gate of the barley-merchants',
    postern: 'The postern on the dyers’ side',
    quarter: 'The dyers’ street',
    streets: ['The street of the potters', 'The street of the weavers'],
    tabletHouse: 'The house of tablets',
    market: 'The market',
    well: 'The well',
    sources: ['fl-354 (PAL·CH·08471)', 'scenario-scripts/sc-919.json'],
  },
};

const GENERIC: StreetNames = {
  riverGate: 'The river gate', marketGate: null, postern: null, quarter: null, streets: [],
  tabletHouse: 'The tablet house', market: 'The market', well: 'The well', sources: [],
};

export function streetNames(scenario: string | null | undefined): StreetNames {
  return (scenario && BY_SCENARIO[scenario]) || GENERIC;
}

/** "The north gate" … from a bearing (x east, z south). */
export function compassGate(ang: number): string {
  const d = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  const i = Math.round((((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8;
  return `The ${d[i]} gate`;
}
