// The Tablet House: the scenario shape (docs/lld/tablet-house.md, contract type ScenariosJson) and the game's own types.
// Every figure in a Scenario comes from the record; only the scribe's private life and choices are invented.
// `Scenario` here is the design's shape plus the few optional extras the game reads; the engine's contract type is a
// superset of it (checked below), so scenarios.json plays as is and a fixture can stay small.
import type { Scenario as ContractScenario } from '../../../../engine/src/export/contract.ts';

export interface Scenario {
  id: string;                    // "sc-<eventId>"
  event: number; year: number;   // the siege/sack event and its year
  city: { id: string; name: string; pop: number; cell: number; port: boolean; region?: string };
  state: {
    id: string; name: string; ruler: { id: string; name: string; sex: 'm' | 'f'; age: number; title?: string }; faith: string;
    gods: { name: string; sex: 'm' | 'f'; role: string }[]; coin: string | null; grain: number | null;
  };
  enemy: { id: string; name: string; ruler: { id: string; name: string; sex: 'm' | 'f' } };
  medium: string;                // clay tablet / papyrus / paper … at that date
  script: string;                // the writing system's name
  battle: {
    id: string; place: string; ours: number; theirs: number; oursLost: number; theirsLost: number;
    won: boolean; commander: { name: string; sex: 'm' | 'f'; isKing: boolean; killed?: boolean };
    name?: string; date?: string;
  };
  outcome: 'sacked' | 'conquered' | 'treaty' | 'held';
  burnedArchives: boolean;
  treaty: { id: string; ceded: number; tribute: string | null; truce: number | null; text: string | null } | null;
  hardship: { famine: boolean; plague: string | null; drought: boolean; grainBefore: number | null; grainAfter: number | null };
  chronicle: {
    catalog: string; author: string; year: number; oursLost: number | null; theirsLost: number | null;
    outcomeWords: string | null; quote: string | null; id?: string; title?: string;
  } | null;
  names: { f: string[]; m: string[] };
  camera: { x: number; y: number; z: number; target: [number, number, number] } | null;
  /** Optional extras from the export: the defender's technological era (0 Bronze Age … 6 Post-industrial), titles, dates. */
  eraIndex?: number;
  title?: string;
  date?: string;
}

// scenarios.json entries must play as they are
const _fits = (s: ContractScenario): Scenario => s;
void _fits;

export interface ScenariosFile { scenarios: Scenario[] }

/** What the player writes into a slot on the tablet. */
export type Pick = 'true' | 'rounded' | 'boasted';
export type SlotId = 'muster' | 'ours' | 'theirs' | 'field' | 'end';
export type DayNo = 1 | 2 | 3 | 4 | 5;
/** A beat drives the art, the sound and the 3D backdrop. */
export type Beat = 'title' | 'muster' | 'field' | 'walls' | 'sack' | 'treaty' | 'held' | 'tablet' | 'ending';

export interface Meters { favour: number; conscience: number; household: number }
export type Effects = Partial<Meters>;
