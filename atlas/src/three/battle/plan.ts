// The battle as a plan: who stands where, who falls when, and what each document claims, all from the record.
// Pure (no three.js, no DOM): the same battle always gives the same plan. The only "chance" is a hash of the battle
// id, the side and the figure's index, so the dead are the same men every time the battle is replayed.
//
// Scale: a battle's larger army gets a figure count that grows with the log of its size (so 400 men and five million
// both read), and that sets how many men one figure stands for. The smaller army, the casualties and every ghost army
// a document claims use that same rate, so within one battle the figures are honest: twice the men, twice the
// figures, and a claim seven times the record is drawn seven times as large.

import type { BattleClaim, BattleJson } from '../../../../engine/src/export/contract.ts';
import { BATTLE_KIT } from '../../../../engine/src/export/contract.ts';

export type Troop = 'spear' | 'sword' | 'bow' | 'sling' | 'xbow' | 'chariot' | 'horse' | 'knight' | 'pike' | 'musket' | 'cannon' | 'rifle' | 'gun' | 'tank';
export type Style = 'bronze' | 'iron' | 'medieval' | 'gunpowder' | 'industrial' | 'modern';
export const TROOP_NAME: Record<Troop, [string, string]> = {
  spear: ['spearman', 'spearmen'], sword: ['swordsman', 'heavy infantry'], bow: ['archer', 'archers'], sling: ['slinger', 'slingers'],
  xbow: ['crossbowman', 'crossbowmen'], chariot: ['chariot', 'chariots'], horse: ['horseman', 'cavalry'], knight: ['knight', 'mounted knights'],
  pike: ['pikeman', 'pikemen'], musket: ['musketeer', 'musketeers'], cannon: ['cannon', 'cannon'], rifle: ['rifleman', 'riflemen'],
  gun: ['field gun', 'artillery'], tank: ['tank', 'tanks'],
};
/** Troops that are machines: one model stands for a battery's worth of figures. */
export const MACHINE: Partial<Record<Troop, number>> = { cannon: 6, gun: 6, tank: 8, chariot: 2 };
const MOUNTED = new Set<Troop>(['horse', 'knight', 'chariot']);
const MISSILE = new Set<Troop>(['bow', 'sling', 'xbow', 'musket']);

// ---------------------------------------------------------------- hashing (deterministic, never Math.random)
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
/** A stable number in (0, 1) for a key. */
export const unit = (s: string) => (hash(s) + 0.5) / 4294967296;

// ---------------------------------------------------------------- kit → troops
export function kitHas(kit: number, key: (typeof BATTLE_KIT)[number]): boolean {
  return (kit & (1 << BATTLE_KIT.indexOf(key))) !== 0;
}
export function styleOf(kit: number): Style {
  if (kitHas(kit, 'combustion')) return 'modern';
  if (kitHas(kit, 'rifles')) return 'industrial';
  if (kitHas(kit, 'gunpowder')) return 'gunpowder';
  if (kitHas(kit, 'crossbow')) return 'medieval';
  if (kitHas(kit, 'iron')) return 'iron';
  return 'bronze';
}
export const STYLE_NAME: Record<Style, string> = {
  bronze: 'Bronze-armed', iron: 'Iron-armed', medieval: 'Mail and crossbow', gunpowder: 'Pike and shot', industrial: 'Rifle and gun', modern: 'Rifle, gun and engine',
};

/** The arms a muster roll names, as the troops the diorama has. */
const MUSTER_ARM: Record<string, Troop> = {
  spearmen: 'spear', archers: 'bow', 'chariot crews': 'chariot', slingers: 'sling', horsemen: 'horse', 'shield-bearers': 'sword',
  'heavy infantry': 'sword', 'light infantry': 'spear', cavalry: 'horse', 'men-at-arms': 'sword', 'mounted knights': 'knight', levies: 'spear',
  pikemen: 'pike', musketeers: 'musket', gunners: 'cannon', dragoons: 'horse', axemen: 'sword', skirmishers: 'sling', halberdiers: 'pike',
  crossbowmen: 'xbow', 'light horse': 'horse',
};

/** Shares of an army by troop, from the techs its state knew (a stylised order of battle; see `fromMuster`). */
export function shares(kit: number): [Troop, number][] {
  const st = styleOf(kit);
  const chariot = kitHas(kit, 'chariot'), cav = kitHas(kit, 'cavalry');
  switch (st) {
    case 'bronze': return chariot ? [['spear', 0.52], ['bow', 0.18], ['sling', 0.16], ['chariot', 0.14]] : [['spear', 0.6], ['bow', 0.2], ['sling', 0.2]];
    case 'iron': return cav ? [['spear', 0.36], ['sword', 0.26], ['bow', 0.2], ['horse', 0.18]] : chariot ? [['spear', 0.4], ['sword', 0.26], ['bow', 0.2], ['chariot', 0.14]] : [['spear', 0.44], ['sword', 0.3], ['bow', 0.26]];
    case 'medieval': return cav ? [['sword', 0.34], ['spear', 0.2], ['xbow', 0.24], ['knight', 0.22]] : [['sword', 0.4], ['spear', 0.32], ['xbow', 0.28]];
    case 'gunpowder': return [['pike', 0.38], ['musket', 0.4], [cav ? 'horse' : 'pike', 0.14], ['cannon', 0.08]];
    case 'industrial': return [['rifle', 0.84], ['gun', 0.1], ['horse', 0.06]];
    case 'modern': return [['rifle', 0.8], ['gun', 0.1], ['tank', 0.1]];
  }
}

export function fromMuster(arms: [string, number][]): [Troop, number][] {
  const by = new Map<Troop, number>();
  const total = arms.reduce((t, [, m]) => t + m, 0) || 1;
  for (const [a, m] of arms) { const t = MUSTER_ARM[a] ?? 'spear'; by.set(t, (by.get(t) ?? 0) + m / total); }
  return [...by];
}

// ---------------------------------------------------------------- figures
export interface Fig {
  troop: Troop;
  /** Position in the army's own frame: `back` behind its front line, `lat` to its right (scene units). */
  back: number;
  lat: number;
  row: number;
  /** When the figure falls (0..1 of the battle's tally), or Infinity if it lives. */
  fall: number;
  /** Extra ground covered in a rout (fraction), and sideways scatter. */
  flee: number;
  drift: number;
  banner: boolean;
  /** Turn on the spot (radians), a little life in the ranks. */
  yaw: number;
}

export interface ArmyPlan {
  side: 0 | 1;
  men: number;
  lost: number;
  figs: Fig[];
  /** Figures that fall (exactly round(figures × losses / men), at least one if anyone died). */
  fallen: number;
  width: number;
  depth: number;
  troops: [Troop, number][];
  fromMuster: string | null;
  style: Style;
  /** Where the commander's standard stands (army frame). */
  standard: { back: number; lat: number };
}

export interface GhostPlan {
  claim: BattleClaim;
  /** Per side: the claimed host as a footprint (figures), the claimed dead (figures). */
  host: [number | null, number | null];
  dead: [number | null, number | null];
}

export interface BattlePlan {
  id: string;
  /** Men per figure, the same for both armies and for every ghost. */
  rate: number;
  armies: [ArmyPlan, ArmyPlan];
  won: 0 | 1;
  decisive: number;
  fell: -1 | 0 | 1;
  ghosts: GhostPlan[];
  /** Half the gap between the two fronts at the start. */
  gap: number;
  /** How far each army's guns or engines stand ahead of its line. */
  lead: [number, number];
}

/** How large the figures are drawn (models are built ~0.1 tall; spacing and offsets scale with them). */
export const FIG = 1.3;
export const SPACING: Record<'foot' | 'mounted' | 'machine', [number, number]> = { foot: [0.078 * FIG, 0.094 * FIG], mounted: [0.12 * FIG, 0.17 * FIG], machine: [0.24 * FIG, 0.3 * FIG] };
const spacingOf = (t: Troop) => (MACHINE[t] && t !== 'chariot' ? SPACING.machine : MOUNTED.has(t) ? SPACING.mounted : SPACING.foot);

/** Figures for the larger army: logarithmic in its size. */
export function figuresFor(men: number): number {
  return Math.round(Math.max(64, Math.min(560, 70 + 92 * Math.log10(Math.max(1, men) / 300))));
}

/** Split `n` figures among troops by shares (largest remainder), machines rounded to whole models. */
function apportion(n: number, sh: [Troop, number][]): [Troop, number][] {
  const tot = sh.reduce((t, [, w]) => t + w, 0) || 1;
  const raw = sh.map(([t, w]) => [t, (n * w) / tot] as [Troop, number]);
  const out = raw.map(([t, x]) => [t, Math.floor(x)] as [Troop, number]);
  let left = n - out.reduce((t, [, x]) => t + x, 0);
  const order = raw.map(([, x], i) => [x - Math.floor(x), i] as [number, number]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k++, left--) out[order[k % order.length][1]][1]++;
  return out.filter(([, x]) => x > 0);
}

/** Lay out an army: foot in the centre (missile troops behind the line), horse on the wings, guns ahead
 *  (gunpowder) or behind (rifles), engines in front. Returns figures in the army's frame. */
function formation(id: string, side: 0 | 1, n: number, sh: [Troop, number][]): { figs: Fig[]; width: number; depth: number } {
  const parts = apportion(n, sh);
  const foot = parts.filter(([t]) => !MOUNTED.has(t) && !MACHINE[t]);
  const mounted = parts.filter(([t]) => MOUNTED.has(t));
  const machines = parts.filter(([t]) => MACHINE[t] && !MOUNTED.has(t));
  const figs: Fig[] = [];
  const nFoot = foot.reduce((t, [, x]) => t + x, 0);
  // the foot: a block about three times as wide as deep; melee ranks first, missile ranks behind
  const [sx, sz] = SPACING.foot;
  const files = Math.max(6, Math.ceil(Math.sqrt((nFoot * 3.1 * sz) / sx)));
  const ordered = [...foot.filter(([t]) => !MISSILE.has(t)), ...foot.filter(([t]) => MISSILE.has(t))];
  let k = 0;
  for (const [t, x] of ordered) for (let i = 0; i < x; i++, k++) {
    const row = Math.floor(k / files), col = k % files;
    const inRow = Math.min(files, nFoot - row * files);
    const lat = (col - (inRow - 1) / 2) * sx;
    figs.push({ troop: t, back: row * sz + (row % 2) * 0.012 * FIG, lat: lat + (row % 2 ? sx * 0.25 : 0), row, fall: Infinity, flee: 0, drift: 0, banner: false, yaw: 0 });
  }
  const footW = Math.min(files, Math.max(1, nFoot)) * sx;
  const footD = Math.ceil(nFoot / files) * sz;
  // standard-bearers in the front rank: one per twelve files or so
  const front = figs.filter((f) => f.row === 0);
  const nb = Math.max(1, Math.min(7, Math.round(files / 12)));
  for (let b = 0; b < nb; b++) { const f = front[Math.round(((b + 0.5) / nb) * (front.length - 1))]; if (f) f.banner = true; }
  // mounted on the wings, in ranks of their own
  let wingW = 0;
  const nMounted = mounted.reduce((t, [, x]) => t + x, 0);
  if (nMounted) {
    let idx = 0;
    for (const [t, x] of mounted) {
      const [mx, mz] = spacingOf(t);
      const per = MACHINE[t] ?? 1;
      const models = Math.max(1, Math.round(x / per));
      for (let i = 0; i < models; i++, idx++) {
        const wing = idx % 2 ? 1 : -1;
        const j = Math.floor(idx / 2);
        const cols = Math.max(2, Math.ceil(Math.sqrt(nMounted / 2 / 1.6)));
        const row = Math.floor(j / cols), col = j % cols;
        const lat = wing * (footW / 2 + 0.16 * FIG + col * mx + mx / 2);
        wingW = Math.max(wingW, Math.abs(lat) + mx / 2 - footW / 2);
        figs.push({ troop: t, back: row * mz + 0.02 * FIG, lat, row, fall: Infinity, flee: 0, drift: 0, banner: false, yaw: 0 });
      }
    }
  }
  // machines: guns ahead of the line (cannon) or behind it (field guns), engines in front
  for (const [t, x] of machines) {
    const models = Math.max(1, Math.round(x / (MACHINE[t] ?? 1)));
    for (let i = 0; i < models; i++) {
      const lat = ((i + 0.5) / models - 0.5) * footW * 0.92;
      const back = (t === 'gun' ? footD / FIG + 0.28 : t === 'tank' ? -0.36 : -0.3) * FIG;
      figs.push({ troop: t, back, lat, row: t === 'gun' ? 99 : -1, fall: Infinity, flee: 0, drift: 0, banner: false, yaw: 0 });
    }
  }
  for (let i = 0; i < figs.length; i++) {
    const f = figs[i];
    f.yaw = (unit(`${id}:${side}:yaw:${i}`) - 0.5) * 0.22;
    f.back += (unit(`${id}:${side}:jz:${i}`) - 0.5) * 0.014 * FIG;
    f.lat += (unit(`${id}:${side}:jx:${i}`) - 0.5) * 0.012 * FIG;
  }
  return { figs, width: footW + 2 * wingW, depth: footD };
}

/** How many men a figure model stands for (machines stand for a battery). */
export const menPer = (t: Troop) => MACHINE[t] ?? 1;

export function planBattle(id: string, b: BattleJson): BattlePlan {
  const big = Math.max(b.size[0], b.size[1], 1);
  const nBig = figuresFor(big);
  const rate = big / nBig;
  const armies = ([0, 1] as const).map((side) => {
    const men = b.size[side];
    const muster = b.claims.find((c) => c.kind === 'muster' && c.side === side && c.arms?.length);
    const sh = muster ? fromMuster(muster.arms!) : shares(b.kit[side]);
    const n = Math.max(10, Math.round(men / rate));
    const { figs, width, depth } = formation(id, side, n, sh);
    // who falls: the losses' share of the figures, front ranks first (an exponential race weighted by rank)
    const weight = (f: Fig) => (f.row < 0 ? 0.5 : f.row === 99 ? 0.12 : MOUNTED.has(f.troop) ? 0.45 : MISSILE.has(f.troop) ? 0.3 * Math.exp(-f.row / 6) : Math.exp(-f.row / 3.2) + 0.08);
    const units = figs.map((f, i) => ({ i, w: menPer(f.troop), key: -Math.log(unit(`${id}:${side}:fall:${i}`)) / weight(f) })).sort((x, y) => x.key - y.key);
    const totalUnits = figs.reduce((t, f) => t + menPer(f.troop), 0);
    const want = b.losses[side] > 0 ? Math.max(1, Math.round((totalUnits * b.losses[side]) / Math.max(1, men))) : 0;
    let got = 0, fallen = 0;
    for (const u of units) {
      if (got >= want) break;
      if (got + u.w > want + u.w / 2) continue; // a gun counts for a battery: only if it fits
      figs[u.i].fall = (got + u.w / 2) / Math.max(1, want);
      got += u.w;
      fallen++;
    }
    // the rout: how far each survivor runs, and how wide
    for (let i = 0; i < figs.length; i++) {
      figs[i].flee = unit(`${id}:${side}:flee:${i}`);
      figs[i].drift = unit(`${id}:${side}:drift:${i}`) - 0.5;
    }
    const plan: ArmyPlan = {
      side, men, lost: b.losses[side], figs, fallen, width, depth,
      troops: apportion(n, sh), fromMuster: muster?.art ?? null, style: styleOf(b.kit[side]),
      standard: { back: depth + 0.42 * FIG, lat: 0 },
    };
    return plan;
  }) as [ArmyPlan, ArmyPlan];
  const ghosts: GhostPlan[] = b.claims.filter((c) => c.kind !== 'muster' || c.size[c.side] !== b.size[c.side]).map((c) => ({
    claim: c,
    host: [c.size[0] === null ? null : Math.round(c.size[0] / rate), c.size[1] === null ? null : Math.round(c.size[1] / rate)],
    dead: [c.losses[0] === null ? null : Math.round(c.losses[0] / rate), c.losses[1] === null ? null : Math.round(c.losses[1] / rate)],
  }));
  const reach = Math.max(armies[0].width, armies[1].width);
  const lead = armies.map((a) => Math.max(0, ...a.figs.map((f) => -f.back))) as [number, number];
  const gap = Math.max(1.2, Math.min(2.0, 0.85 + reach * 0.2)) + (lead[0] + lead[1]) / 2;
  return { id, rate, armies, won: b.won, decisive: b.decisive, fell: b.fell, ghosts, gap, lead };
}

/** How far a claim strays from the record: the largest ratio among the figures it gives (>= 1 either way). */
export function stray(c: BattleClaim, b: BattleJson): number {
  let m = 1;
  for (const s of [0, 1] as const) {
    for (const [v, t] of [[c.size[s], b.size[s]], [c.losses[s], b.losses[s]]] as [number | null, number][]) {
      if (v === null || t <= 0) continue;
      const r = v / t;
      m = Math.max(m, r >= 1 ? r : 1 / Math.max(r, 1e-6));
    }
  }
  return m;
}

// ---------------------------------------------------------------- the replay: one clock, 0 → 1
/** The phases, as fractions of the replay. */
export const PHASE = { advance: [0.06, 0.36], melee: [0.36, 0.8], rout: [0.8, 1] } as const;
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lin = (a: number, b: number, x: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));

/** The tally: how far through its dead a side is at time t (0..1). The counter shows losses × this. */
export function tally(p: BattlePlan, side: 0 | 1, t: number): number {
  const decisiveRout = p.won !== side && p.decisive > 0.5;
  // the loser of a decisive battle loses its last men in the pursuit
  if (decisiveRout) return 0.86 * lin(PHASE.melee[0] + 0.02, PHASE.melee[1], t) + 0.14 * lin(PHASE.rout[0], PHASE.rout[0] + 0.14, t);
  return lin(PHASE.melee[0] + 0.02, PHASE.melee[1], t);
}

/** Where an army's front line stands at time t, as its advance from where it started (scene units, toward the
 *  enemy), and how far the loser has fallen back (applied per figure, with scatter). */
export function frontAt(p: BattlePlan, side: 0 | 1, t: number): number {
  const winner = p.won === side;
  // the lines meet (guns and engines ahead of them touching first) at a point that favours the winner: an
  // attacker who wins drives on, a defender who wins barely leaves its ground
  const closing = 2 * p.gap - 0.08 - p.lead[0] - p.lead[1];
  const shareD = p.won === 0 ? 0.18 : 0.28;
  const advance = side === 1 ? closing * shareD : closing * (1 - shareD);
  let x = advance * smooth(PHASE.advance[0], PHASE.advance[1], t);
  // in the melee the losing line bends back; the winner keeps contact if it attacked, holds if it defended
  const bend = (0.1 + 0.22 * p.decisive) * smooth(PHASE.melee[0], PHASE.melee[1], t);
  if (!winner) x -= bend;
  else if (side === 0) x += bend * 0.85;
  // the winner holds the field
  if (winner) x += 0.12 * smooth(PHASE.rout[0], PHASE.rout[1], t) * (side === 0 ? 1 : 0.4);
  return x;
}

/** The loser's retreat at time t for one figure (scene units back, and sideways). */
export function fleeAt(p: BattlePlan, side: 0 | 1, f: Fig, t: number): [number, number] {
  if (p.won === side) return [0, 0];
  const k = smooth(PHASE.rout[0], PHASE.rout[1], t);
  if (k <= 0) return [0, 0];
  const dist = 0.55 + 1.7 * p.decisive;
  const scatter = p.decisive > 0.5 ? (p.decisive - 0.5) * 2 : 0;
  return [k * dist * (1 + (f.flee - 0.5) * (0.25 + 0.9 * scatter)), k * f.drift * (0.12 + 0.9 * scatter)];
}

export function phaseLabel(t: number): 'array' | 'advance' | 'melee' | 'rout' | 'end' {
  if (t <= PHASE.advance[0]) return 'array';
  if (t < PHASE.advance[1]) return 'advance';
  if (t < PHASE.melee[1]) return 'melee';
  if (t < 0.999) return 'rout';
  return 'end';
}
