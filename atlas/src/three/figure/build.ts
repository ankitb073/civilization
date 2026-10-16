// buildFigure(person): a person of the record as a painted game piece. Deterministic: the same page always gives the
// same piece (the only "chance" is a hash of the id — hair colour, the cut of a hem), and nothing is shown that the
// record does not say. No faces: a turned head of bare wood, like the pieces of an old board game.
//
//   body       sex (shoulders, waist, the gown) and age (a child is small and big-headed; grey hair from 60, a stoop
//              from 70) at the year the piece shows them
//   costume    the age of their prime (kilts and sheath gowns in the Bronze Age; tunics and cloaks; long robes; cotes
//              and hose; doublets and farthingales; frock coats and uniforms; suits); the cut of its hem by their people
//   colours    their seal's tinctures (heraldry.ts): a member of a ruling house wears the house's quarters per pale and
//              counterchanged; anyone else the state's colour trimmed with its metal
//   props      their roles: crown and sceptre; the seal of state in a regent's hands; helmet, shield (painted with the
//              seal) and spear, sword or rifle by age for a general; tablet, scroll or book; scales or ledger; staff and
//              censer; the star-topped staff; the banner of the broken chain; a sealed letter; tools; trowel and brush
//   death      a black armband for those who fell in battle; a black cloth over the base of the executed
import { Group, Matrix4, Quaternion, Shape, Vector3 } from 'three';
import { about, ball, box, cap, cone, cyl, garment, Kit, lathe, mixHex, mul, ring, rod, RX, RY, RZ, shade, slab, smooth, starShape, T, tube, V } from './kit.ts';
import { buildBase } from './base.ts';
import { figureSpec, hash, type FigureSource, type FigureSpec } from './spec.ts';
import * as P from './props.ts';

export type { FigureSpec } from './spec.ts';
export interface BuildOptions { year?: number }

const SKIN = '#dcb88a';      // bare limewood
const HAIR = ['#2a211b', '#3b2a1f', '#4e3524', '#2f2a26', '#5b3d26'];
const HOSE = '#3a332d';
const SHOE = '#2a2420';

// ---------------------------------------------------------------- the body's measure
interface Rig {
  s: number; fem: boolean; child: boolean;
  ankle: number; knee: number; hip: number; waist: number; chest: number; shoulder: number; neck: number;
  head: number; headR: number; shW: number; waistR: number; legX: number;
  stoop: number;
}
function rigOf(f: FigureSpec): Rig {
  const fem = f.sex === 'f';
  const a = f.age;
  const child = a < 15;
  let s = child ? 0.6 + 0.3 * Math.max(0, a) / 15 : a < 18 ? 0.95 : 1;
  if (fem) s *= 0.965;
  // a child's head is large for its body
  const headR = 0.071 * Math.pow(s, child ? 0.15 : 0.4);
  const neck = 0.8 * s;
  return {
    s, fem, child,
    ankle: 0.05 * s, knee: 0.27 * s, hip: 0.47 * s, waist: 0.565 * s, chest: 0.67 * s, shoulder: 0.762 * s, neck,
    head: neck + headR * 0.93, headR,
    shW: (fem ? 0.098 : 0.116) * s * (child ? 0.92 : 1), waistR: (fem ? 0.064 : 0.074) * s, legX: 0.046 * s,
    stoop: a >= 72 ? 0.17 : a >= 62 ? 0.09 : 0,
  };
}

// ---------------------------------------------------------------- what they wear
type Dress = 'gown' | 'robe' | 'kilt' | 'tunic' | 'longtunic' | 'cote' | 'doublet' | 'farthingale' | 'coat' | 'bustle' | 'suit' | 'skirtsuit' | 'uniform';
type Head = 'none' | 'crown' | 'circlet' | 'helmet' | 'brim' | 'tophat' | 'flatcap' | 'mitre' | 'hood' | 'veil' | 'skullcap' | 'fillet';
interface Look {
  dress: Dress;
  upper: [string, string];   // dexter (the figure's right, -x), sinister
  lower: [string, string];
  sleeves: 'long' | 'short';
  legs: string | [string, string] | null;
  shoes: string;
  boots: boolean;
  trim: string;
  cloak: null | { col: string; len: 'cape' | 'cloak' | 'mantle'; ermine: boolean };
  collar: 'none' | 'broad' | 'ruff' | 'cravat' | 'ermine' | 'band';
  sash: string | null;
  belt: string | null;
  armour: 'none' | 'corslet' | 'cuirass' | 'mail' | 'surcoat' | 'breastplate' | 'epaulettes' | 'webbing';
  head: Head;
  hair: string;
  hairStyle: 'short' | 'long' | 'bun' | 'bob' | 'none';
  motif: number;             // the hem's band, by their people
}
const isMetal = (t: FigureSpec['tinctures'], c: string) => c === t.metal;

function lookOf(f: FigureSpec, rig: Rig): Look {
  const t = f.tinctures;
  const era = f.era, fem = rig.fem, R = f.roles2;
  const ruler = f.role === 'ruler' || R.has('ruler');
  const general = f.role === 'general';
  const priest = f.role === 'priest', prophet = f.role === 'prophet';
  const scholar = ['scribe', 'historian', 'translator', 'philosopher'].includes(f.role);
  // a ruling house wears its quarters; anyone else the state's colour, trimmed in its metal (never metal on metal)
  const upper: [string, string] = t.quarterly ? [t.a, t.b] : [t.colour, t.colour];
  const lower: [string, string] = t.quarterly ? [t.b, t.a] : [t.colour, t.colour];
  const trimOf = (c: string) => (isMetal(t, c) ? t.colour : t.metal);
  const hair = f.age >= 75 ? '#e2ddd3' : f.age >= 60 ? '#b4afa6' : HAIR[hash(`hair:${f.id}`) % HAIR.length];
  const L: Look = {
    dress: fem ? 'gown' : 'tunic', upper, lower, sleeves: 'long', legs: HOSE, shoes: SHOE, boots: false, trim: trimOf(upper[0]),
    cloak: null, collar: 'none', sash: null, belt: P.C.leather, armour: 'none', head: 'none', hair,
    hairStyle: fem ? 'long' : 'short', motif: hash(`cul:${f.people}`) % 4,
  };
  const legsCounter: [string, string] = t.quarterly ? [t.b, t.a] : [HOSE, HOSE];
  switch (era) {
    case 0:
      L.dress = fem || ruler || priest || prophet ? 'gown' : 'kilt';
      L.sleeves = 'short'; L.collar = 'broad'; L.legs = fem ? null : SKIN; L.shoes = P.C.leather; L.belt = t.metal;
      if (fem) L.head = 'fillet';
      if (ruler) L.cloak = { col: t.colour, len: 'cape', ermine: false };
      break;
    case 1:
      L.dress = fem || ruler || priest || prophet ? 'gown' : 'tunic';
      L.sleeves = fem ? 'long' : 'short'; L.legs = fem ? null : SKIN; L.boots = !fem; L.shoes = P.C.leather;
      L.cloak = { col: fem ? t.metal === upper[0] ? t.colour : shade(t.colour, -0.15) : shade(t.colour, -0.12), len: ruler ? 'mantle' : 'cloak', ermine: false };
      if (fem) L.head = 'veil';
      if (ruler && !fem) L.cloak = { col: t.colour, len: 'mantle', ermine: false };
      break;
    case 2:
      L.dress = fem || ruler || priest || prophet || scholar ? 'gown' : 'longtunic';
      L.legs = fem ? null : HOSE; L.collar = ruler ? 'broad' : 'none';
      L.sash = ruler ? null : trimOf(upper[0]);
      L.cloak = ruler ? { col: t.colour, len: 'mantle', ermine: false } : fem ? null : { col: shade(t.colour, -0.12), len: 'cloak', ermine: false };
      if (fem) L.head = 'veil';
      break;
    case 3:
      L.dress = fem ? 'gown' : ruler || priest || prophet ? 'robe' : 'cote';
      L.legs = legsCounter; L.shoes = SHOE;
      if (fem) L.head = 'veil';
      if (ruler) L.cloak = { col: t.colour, len: 'mantle', ermine: true };
      else if (!fem && (scholar || f.role === 'merchant' || f.role === 'envoy')) L.collar = 'band';
      break;
    case 4:
      L.dress = fem ? 'farthingale' : priest || prophet ? 'robe' : 'doublet';
      L.collar = 'ruff'; L.legs = HOSE; L.hairStyle = fem ? 'bun' : 'short';
      if (ruler) L.cloak = { col: t.colour, len: 'mantle', ermine: true };
      else if (!fem && !general) L.cloak = { col: shade(t.colour, -0.18), len: 'cape', ermine: false };
      if (!fem && !ruler && !general && !priest) L.head = 'flatcap';
      break;
    case 5:
      L.dress = fem ? 'bustle' : ruler || general ? 'uniform' : priest || prophet ? 'robe' : 'coat';
      L.collar = fem ? 'band' : 'cravat'; L.legs = '#2b2a2c'; L.hairStyle = fem ? 'bun' : 'short';
      L.lower = fem ? lower : ['#2b2a2c', '#2b2a2c'];
      if (ruler) { L.sash = trimOf(upper[0]); L.armour = 'epaulettes'; L.cloak = { col: t.colour, len: 'mantle', ermine: true }; }
      if (!fem && ['merchant', 'inventor', 'envoy', 'president'].includes(f.role)) L.head = 'tophat';
      if (f.role === 'president') L.sash = trimOf(upper[0]);
      break;
    default:
      L.dress = fem ? 'skirtsuit' : general ? 'uniform' : 'suit';
      L.collar = 'none'; L.legs = fem ? '#3a3533' : '#2e2d30'; L.hairStyle = fem ? 'bob' : 'short';
      L.lower = fem ? lower : ['#2e2d30', '#2e2d30'];
      if (ruler) { L.sash = trimOf(upper[0]); L.cloak = { col: t.colour, len: 'mantle', ermine: true }; }
      if (f.role === 'president') L.sash = trimOf(upper[0]);
      break;
  }
  // soldiers' kit by age
  if (general) {
    L.head = 'helmet';
    L.armour = (['corslet', 'cuirass', 'mail', 'surcoat', 'breastplate', 'epaulettes', 'webbing'] as const)[era];
    if (era <= 1) { L.dress = 'kilt'; L.legs = SKIN; L.boots = era === 1; }
    if (era === 2) { L.dress = 'longtunic'; L.cloak = { col: shade(t.colour, -0.1), len: 'cloak', ermine: false }; }
    if (era === 3) { L.dress = 'cote'; L.legs = P.C.steel; }
    if (era === 4) { L.dress = 'doublet'; L.boots = true; L.sash = trimOf(upper[0]); L.cloak = null; }
    if (era === 5) { L.dress = 'uniform'; L.sash = trimOf(upper[0]); L.boots = false; }
    if (era >= 6) {
      // field dress: the state's colour dulled toward olive
      const dull = (c: string) => mixHex(c, '#5d6247', 0.55);
      L.upper = [dull(L.upper[0]), dull(L.upper[1])]; L.lower = [dull(L.upper[0]), dull(L.upper[1])];
      L.legs = dull(L.upper[0]); L.boots = true; L.dress = 'uniform';
    }
    if (fem && era <= 3) L.legs = era === 3 ? P.C.steel : SKIN;
  }
  if (ruler) L.head = 'crown';
  else if (f.role === 'regent') L.head = fem ? (era >= 4 ? 'circlet' : L.head === 'veil' ? 'veil' : 'circlet') : 'circlet';
  if (priest) L.head = era <= 1 ? 'skullcap' : era <= 4 ? 'mitre' : 'skullcap';
  if (prophet) L.head = 'hood';
  if (scholar && era <= 1 && !fem) L.head = 'skullcap';
  if (scholar && era === 3 && !fem) L.head = 'hood';
  if (f.role === 'archaeologist') { L.head = 'brim'; L.dress = fem ? 'skirtsuit' : 'coat'; }
  if (priest || prophet) { L.cloak = era >= 2 ? { col: t.colour, len: 'cloak', ermine: false } : L.cloak; L.sash = null; }
  return L;
}

// ---------------------------------------------------------------- the piece
/** Build the figure for a person (their page, or a spec read from it). Its base's top is at y = 0, it faces +z. */
export function buildFigure(person: FigureSpec | FigureSource, opts: BuildOptions = {}): Group {
  const f = 'tinctures' in person ? (opts.year !== undefined ? null : person) : null;
  const spec = f ?? figureSpec('tinctures' in person ? toSource(person) : person, { year: opts.year });
  if (!spec) return new Group();
  const kit = new Kit();
  const rig = rigOf(spec);
  const look = lookOf(spec, rig);
  buildBase(kit, spec);
  body(kit, spec, rig, look);
  const g = kit.build();
  g.name = `figure ${spec.id}`;
  g.userData = { spec, height: rig.head + rig.headR + (look.head === 'crown' || look.head === 'helmet' || look.head === 'tophat' || look.head === 'mitre' ? 0.09 * rig.s : 0.02), tris: kit.tris };
  return g;
}
function toSource(f: FigureSpec): FigureSource {
  // re-read a spec at another year: rebuild its page rows from the spec
  const y = (n: number) => (n < 0 ? `${-n} before AY 0` : `AY ${n}`);
  return {
    id: f.id, title: f.name, t0: f.born, t1: f.died ?? 5000, sigil: f.sigil,
    infobox: [['Born', y(f.born)], ['Died', f.died === null ? 'living' : `${y(f.died)} (${f.death})`], ['People', f.people >= 0 ? `[[cul:${f.people}|]]` : ''], ['Roles', f.roles.map((r) => `${r.role}${r.polity ? ` of [[${r.polity}|${r.place}]]` : ''} (${r.start}${r.end !== r.start ? `–${r.end}` : ''})`).join('; ')]],
  };
}


function body(kit: Kit, f: FigureSpec, r: Rig, L: Look) {
  const s = r.s;
  const t = f.tinctures;
  // ---- legs and feet (unless a long garment hides them)
  const long = ['gown', 'robe', 'farthingale', 'bustle'].includes(L.dress);
  const hemY = { gown: 0.012, robe: 0.012, farthingale: 0.012, bustle: 0.012, kilt: 0.3, tunic: 0.3, longtunic: 0.17, cote: 0.28, doublet: 0.43, coat: 0.27, suit: 0.43, skirtsuit: 0.24, uniform: 0.43 }[L.dress] * s;
  for (const side of [-1, 1]) {
    const lx = side * r.legX;
    const legCol = Array.isArray(L.legs) ? L.legs[side < 0 ? 0 : 1] : L.legs;
    if (!long && legCol) {
      const thick = ['suit', 'uniform', 'coat'].includes(L.dress) ? 1.18 : 1;
      kit.add(tube(V(lx, r.hip, 0), V(lx * 1.05, r.knee, 0.004), 0.037 * s * thick, 0.03 * s * thick, 10), legCol);
      kit.add(tube(V(lx * 1.05, r.knee, 0.004), V(lx * 1.08, r.ankle, 0), 0.03 * s * thick, 0.024 * s * thick, 10), legCol);
      kit.add(ball(V(lx * 1.05, r.knee, 0.004), 0.03 * s * thick), legCol);
      if (L.boots) kit.add(tube(V(lx * 1.06, r.knee - 0.03 * s, 0.003), V(lx * 1.08, r.ankle - 0.01, 0), 0.031 * s, 0.028 * s, 10), L.armour === 'corslet' || L.armour === 'cuirass' ? (f.era === 0 ? P.C.bronze : P.C.leather) : P.C.leather, L.armour === 'corslet' ? 'metal' : 'paint');
      if (L.dress === 'doublet' && !L.boots) kit.add(ring(0.032 * s, 0.006 * s, 14, 5), L.trim, 'paint', T(lx * 1.05, r.knee + 0.02 * s, 0.003));
    }
    // shoes (their toes peep from under a gown)
    kit.add(ball(V(lx * 1.1, 0.018 * s, 0.025 * s), 0.03 * s, 0.85, 0.62, 1.45, 12, 8), L.shoes);
  }
  // ---- the lower garment
  skirt(kit, f, r, L, hemY);
  // ---- upper body: stooped from the waist in old age
  kit.with(about(V(0, r.waist, 0), RX(r.stoop)), () => {
    torso(kit, f, r, L);
    arms(kit, f, r, L);
    head(kit, f, r, L);
  });
  void t;
}

function skirt(kit: Kit, f: FigureSpec, r: Rig, L: Look, hemY: number) {
  const s = r.s;
  const w0 = r.waistR * 1.08;
  const prof: [number, number][] = [];
  const add = (rad: number, y: number) => prof.push([rad, y]);
  if (L.dress === 'farthingale') {
    // a bell over a hoop
    add(w0, r.waist + 0.01 * s); add(w0 * 1.25, r.waist - 0.02 * s); add(0.15 * s, r.hip - 0.02 * s); add(0.19 * s, 0.25 * s); add(0.205 * s, 0.08 * s); add(0.2 * s, hemY);
  } else if (L.dress === 'gown' || L.dress === 'robe' || L.dress === 'bustle') {
    const flare = (L.dress === 'robe' ? 0.165 : r.fem ? 0.165 : 0.15) * s;
    add(w0, r.waist + 0.01 * s); add(w0 * (r.fem ? 1.25 : 1.12), r.hip); add(flare * 0.82, 0.28 * s); add(flare * 0.95, 0.1 * s); add(flare, hemY);
  } else {
    // a skirt to the knee or thigh (kilt, tunic, cote, coat tails, a jacket's hem)
    const flare = (L.dress === 'kilt' ? 0.112 : L.dress === 'longtunic' ? 0.125 : L.dress === 'coat' ? 0.118 : L.dress === 'skirtsuit' ? 0.105 : 0.098) * s;
    add(w0, r.waist + 0.01 * s); add(w0 * 1.18, r.hip); add(flare, hemY + 0.02 * s); add(flare * 1.01, hemY);
  }
  prof.push([prof[prof.length - 1][0] * 0.9, prof[prof.length - 1][1] + 0.004]);
  const zs = L.dress === 'farthingale' ? 0.92 : 0.82;
  const open = L.dress === 'coat';
  // a jacket's or coat's skirt is the jacket's cloth; anything else the lower quarters
  const jacket = ['coat', 'suit', 'uniform', 'doublet'].includes(L.dress);
  const [cd, cs] = jacket ? L.upper : L.lower;
  garment(kit, prof, 24, cd, cs, { zs, phi: open ? [Math.PI * 0.16, Math.PI * 1.68] : undefined });
  if (open) {
    // a coat open in front over its trousers: the waistcoat's skirt shows
    kit.add(lathe([[w0 * 0.98, r.waist + 0.01 * s], [w0 * 1.1, r.hip - 0.01 * s], [w0 * 1.05, r.hip - 0.05 * s]], 16).scale(1, 1, 0.8), L.upper[1] === L.upper[0] ? f.tinctures.metal : L.upper[1]);
  }
  // the hem's band (a band, a double band, a zigzag of studs or a row of dots, by the wearer's people)
  const last = prof[prof.length - 2];
  if (!['suit', 'uniform', 'skirtsuit', 'doublet'].includes(L.dress)) {
    const hy = last[1] + 0.012 * s, hr = last[0] * 0.995;
    kit.add(ring(hr, 0.0055 * s, 40, 5).scale(1, 1, zs), L.trim, 'paint', T(0, hy, 0));
    if (L.motif === 1) kit.add(ring(hr * 0.985, 0.0035 * s, 40, 4).scale(1, 1, zs), L.trim, 'paint', T(0, hy + 0.026 * s, 0));
    if (L.motif >= 2) {
      const n = 18;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const yy = hy + (L.motif === 2 ? (i % 2 ? 0.024 : 0.012) : 0.02) * s;
        const rr = hr * (L.motif === 2 ? 1 : 0.99) * (1 - (yy - hy) / Math.max(0.2, last[1] + 0.25));
        kit.add(ball(V(Math.sin(a) * rr, yy, Math.cos(a) * rr * zs), 0.0055 * s, 1, 1, 0.6, 6, 4), L.trim);
      }
    }
  }
  // the belt
  if (L.belt && !['uniform', 'suit', 'skirtsuit', 'bustle', 'farthingale'].includes(L.dress)) {
    kit.add(ring(r.waistR * 1.12, 0.008 * s, 30, 5).scale(1, 1, 0.82), L.belt, isMetal(f.tinctures, L.belt) ? 'metal' : 'paint', T(0, r.waist + 0.006 * s, 0));
    if (f.role === 'merchant' && f.era <= 4) P.purse(kit, V(-r.waistR * 0.9, r.waist, r.waistR * 0.55), s);
    if (f.role === 'regent') P.keys(kit, V(r.waistR * 0.95, r.waist - 0.005, r.waistR * 0.5), s);
  }
  if (L.dress === 'bustle') kit.add(ball(V(0, r.hip - 0.02 * s, -0.12 * s), 0.09 * s, 1.1, 0.9, 0.8), L.lower[0]);
  if (L.dress === 'doublet') {
    // trunk hose: two puffs at the hips
    for (const side of [-1, 1]) kit.add(ball(V(side * r.legX * 1.25, r.hip - 0.035 * s, 0), 0.062 * s, 1, 0.85, 0.95), side < 0 ? L.lower[0] : L.lower[1]);
  }
  if (L.dress === 'uniform' && f.era === 5) for (const side of [-1, 1]) kit.add(box(V(side * (r.legX + 0.031 * s), r.knee, 0.0), 0.004 * s, 0.33 * s, 0.012 * s), L.trim);
}

function torso(kit: Kit, f: FigureSpec, r: Rig, L: Look) {
  const s = r.s;
  const prof: [number, number][] = r.fem
    ? [[0.088, r.hip], [0.066, r.waist], [0.079, r.chest - 0.03 * s], [0.084, r.chest + 0.02 * s], [0.078, r.shoulder - 0.012 * s], [0.05, r.neck - 0.012 * s], [0.026, r.neck + 0.006 * s]]
    : [[0.084, r.hip], [0.077, r.waist], [0.091, r.chest - 0.02 * s], [0.095, r.chest + 0.04 * s], [0.086, r.shoulder - 0.004 * s], [0.052, r.neck - 0.01 * s], [0.028, r.neck + 0.006 * s]];
  const p2 = prof.map(([rad, y]) => [rad * s * (r.child ? 0.95 : 1), y] as [number, number]);
  const xs = r.shW / (p2[4][0] * 1.0) * 0.93;
  // broad at the shoulders, round at the waist
  const xsAt = (y: number) => 1 + (xs - 1) * smooth(r.waist, r.chest + 0.02 * s, y);
  p2[0][0] = Math.min(p2[0][0], r.waistR * 1.05);
  garment(kit, p2, 22, L.upper[0], L.upper[1], { xs: xsAt, zs: 0.74 });
  const t = f.tinctures;
  // armour over it
  if (L.armour === 'corslet' || L.armour === 'cuirass' || L.armour === 'breastplate') {
    const ap = p2.slice(0, 5).map(([rad, y], i) => [rad * 1.08 + (i === 0 ? 0.006 * s : 0), y] as [number, number]);
    ap[0][1] = r.waist - 0.03 * s;
    const col = L.armour === 'corslet' ? (f.era === 0 ? P.C.bronze : P.C.leather) : f.era <= 1 ? P.C.bronze : P.C.steel;
    garment(kit, ap, 22, col, col, { xs: xsAt, zs: 0.8, finish: L.armour === 'corslet' && f.era !== 0 ? 'paint' : 'metal' });
  }
  if (L.armour === 'mail' || L.armour === 'surcoat') {
    // mail to the knee, then (later) a surcoat in the wearer's colours over it
    kit.add(lathe([[r.waistR * 1.2, r.waist], [0.1 * s, r.hip], [0.115 * s, 0.33 * s], [0.118 * s, (L.armour === 'surcoat' ? 0.25 : 0.2) * s]], 20).scale(1, 1, 0.84), '#8a9096', 'metal');
    if (L.armour === 'surcoat') {
      const sp = p2.slice(0, 5).map(([rad, y]) => [rad * 1.06, y] as [number, number]);
      garment(kit, [[0.122 * s, 0.29 * s], [0.108 * s, r.hip - 0.03 * s], ...sp.slice(1, 4)], 22, L.upper[0], L.upper[1], { xs: (y) => xsAt(y) * 0.99, zs: 0.8 });
      kit.add(ring(r.waistR * 1.2, 0.007 * s, 26, 5).scale(1, 1, 0.82), P.C.leather, 'paint', T(0, r.waist, 0));
    } else {
      garment(kit, p2.slice(0, 5).map(([rad, y]) => [rad * 1.05, y] as [number, number]), 22, '#8a9096', '#8a9096', { xs: xsAt, zs: 0.8, finish: 'metal' });
    }
  }
  if (L.armour === 'webbing') {
    for (const side of [-1, 1]) kit.add(tube(V(side * 0.06 * s, r.shoulder - 0.005, 0.045 * s), V(side * 0.05 * s, r.waist, 0.062 * s), 0.008 * s, 0.008 * s, 5).scale(1, 1, 1), '#6b6a52');
    kit.add(ring(r.waistR * 1.18, 0.009 * s, 26, 5).scale(1, 1, 0.84), '#6b6a52', 'paint', T(0, r.waist, 0));
  }
  // jackets: lapels and buttons; uniforms: a row of buttons
  if (['suit', 'skirtsuit', 'uniform', 'coat', 'bustle', 'doublet'].includes(L.dress) && L.armour !== 'breastplate') {
    const zf = (y: number) => {
      // the torso's front at height y
      let rad = p2[0][0];
      for (let i = 1; i < p2.length; i++) if (y <= p2[i][1]) { const k = (y - p2[i - 1][1]) / (p2[i][1] - p2[i - 1][1]); rad = p2[i - 1][0] + k * (p2[i][0] - p2[i - 1][0]); break; }
      return rad * 0.74;
    };
    const metal = L.dress === 'uniform' || L.dress === 'doublet';
    for (let i = 0; i < 4; i++) { const y = r.waist + (i * 0.05 + 0.01) * s; kit.add(ball(V(0, y, zf(y) + 0.002), 0.0065 * s, 1, 1, 0.6, 8, 6), metal ? P.C.brass : '#2a2622', metal ? 'metal' : 'paint'); }
    if (L.dress === 'suit' || L.dress === 'coat') {
      // a shirt front and tie in the jacket's opening
      kit.add(lathe([[0.001, r.chest - 0.02 * s], [0.03 * s, r.chest + 0.03 * s], [0.035 * s, r.shoulder - 0.02 * s], [0.02 * s, r.neck]], 8, -0.6, 1.2), '#f0ece2', 'paint', T(0, 0, 0.022 * s));
      if (L.dress === 'suit') kit.add(box(V(0, r.chest + 0.02 * s, zf(r.chest + 0.02 * s) + 0.006), 0.014 * s, 0.09 * s, 0.006 * s, 0.002 * s), f.tinctures.quarterly ? f.tinctures.b : f.tinctures.metal);
    }
  }
  // collars
  const nz = 0.74;
  if (L.collar === 'broad') kit.add(lathe([[0.03 * s, r.neck + 0.002], [0.075 * s, r.shoulder - 0.0], [0.092 * s, r.shoulder - 0.025 * s]], 22).scale(xs * 0.95, 1, nz + 0.05), L.trim, isMetal(t, L.trim) ? 'metal' : 'paint');
  if (L.collar === 'ruff') kit.add(ring(0.04 * s, 0.017 * s, 24, 8).scale(1, 0.75, 1), '#f3efe6', 'paint', T(0, r.neck + 0.004, 0));
  if (L.collar === 'cravat') kit.add(ball(V(0, r.neck - 0.012 * s, 0.03 * s), 0.02 * s, 1, 1.2, 0.6), '#f0ece2');
  if (L.collar === 'band') kit.add(ring(0.032 * s, 0.009 * s, 20, 6), L.trim, 'paint', T(0, r.neck, 0));
  // a sash from the right shoulder to the left hip
  if (L.sash) {
    const a = V(-r.shW * 0.75, r.shoulder - 0.005, 0), b = V(r.waistR * 0.95, r.waist - 0.01 * s, 0);
    const pts: Vector3[] = [];
    for (let i = 0; i <= 10; i++) {
      const k = i / 10;
      const p = a.clone().lerp(b, k);
      for (const side of [1, -1]) pts.push(V(p.x, p.y, side * (0.074 * s * 1.06 - Math.abs(p.x) * 0.0)));
    }
    const front = pts.filter((_, i) => i % 2 === 0), back = pts.filter((_, i) => i % 2 === 1);
    for (let i = 0; i < 10; i++) {
      kit.add(tube(front[i], front[i + 1], 0.013 * s, 0.013 * s, 6).scale(1, 1, 1), L.sash);
      kit.add(tube(back[i], back[i + 1], 0.013 * s, 0.013 * s, 6), L.sash);
    }
  }
  if (L.armour === 'epaulettes') for (const side of [-1, 1]) kit.add(ball(V(side * r.shW * 0.92, r.shoulder + 0.012 * s, 0), 0.03 * s, 1.1, 0.35, 0.9), P.C.gold, 'metal');
  if (L.armour === 'cuirass' || L.armour === 'breastplate' || L.armour === 'surcoat') for (const side of [-1, 1]) kit.add(cap(0.04 * s, 0, Math.PI * 0.55, 12, 5).scale(1, 0.8, 1), L.armour === 'surcoat' ? '#8a9096' : f.era <= 1 ? P.C.bronze : P.C.steel, 'metal', mul(T(side * r.shW * 0.95, r.shoulder - 0.012 * s, 0), RZ(-side * 0.5)));
  // the cloak, cape or mantle, falling from the shoulders behind
  if (L.cloak) cloak(kit, f, r, L, xs);
}

function cloak(kit: Kit, f: FigureSpec, r: Rig, L: Look, xs: number) {
  const s = r.s;
  const c = L.cloak!;
  const hem = c.len === 'cape' ? r.waist - 0.04 * s : c.len === 'cloak' ? 0.13 * s : 0.012;
  const flare = c.len === 'cape' ? 0.112 : c.len === 'cloak' ? 0.17 : 0.2;
  const prof: [number, number][] = [[0.03 * s, r.neck + 0.004], [0.075 * s, r.shoulder + 0.008 * s], [0.1 * s, r.shoulder - 0.03 * s], [flare * 0.78 * s, (r.shoulder + hem) / 2], [flare * s, hem + 0.02 * s], [flare * 1.02 * s, hem]];
  // open in front: the back and the sides (a short cape only the back)
  const g = c.len === 'cape' ? lathe(prof, 22, Math.PI * 0.5, Math.PI) : lathe(prof, 26, Math.PI * 0.32, Math.PI * 1.36);
  g.scale(xs * 0.97, 1, 0.82);
  // fall straight behind, a little away from the body
  kit.add(g, c.col, 'paint', T(0, 0, -0.008 * s));
  if (c.ermine) {
    // an ermine collar: white fur, black tails
    kit.add(lathe([[0.036 * s, r.neck + 0.004], [0.07 * s, r.shoulder + 0.012 * s], [0.1 * s, r.shoulder - 0.006 * s], [0.112 * s, r.shoulder - 0.04 * s]], 26, Math.PI * 0.3, Math.PI * 1.4).scale(xs * 0.98, 1, 0.84), '#f4f1ea', 'paint', T(0, 0, -0.004));
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * (0.25 + (i / 8) * 1.5);
      kit.add(ball(V(Math.sin(a) * 0.1 * s * xs, r.shoulder - 0.02 * s, Math.cos(a) * 0.1 * s * 0.8), 0.006 * s, 0.6, 1.4, 0.6, 6, 4), '#1d1a18');
    }
    // and an edge of ermine down the front of the mantle
    for (const side of [-1, 1]) {
      const a = side < 0 ? Math.PI * 1.68 : Math.PI * 0.32;
      kit.add(tube(V(Math.sin(a) * 0.1 * s * xs, r.shoulder - 0.03 * s, Math.cos(a) * 0.1 * s * 0.82 - 0.008), V(Math.sin(a) * flare * s * xs * 0.97, hem + 0.01, Math.cos(a) * flare * s * 0.82 - 0.008), 0.012 * s, 0.014 * s, 6), '#f4f1ea');
    }
  } else {
    kit.add(ring(0.012 * s, 0.004 * s, 10, 4).rotateX(Math.PI / 2), f.tinctures.metal, 'metal', T(-r.shW * 0.55, r.shoulder + 0.006 * s, 0.05 * s));
  }
}

// ---------------------------------------------------------------- arms and what the hands hold
type Pose = 'down' | 'staff' | 'front' | 'chest' | 'raise' | 'high' | 'shield' | 'hip' | 'teach' | 'forward';
const HANDS: Record<Pose, [number, number, number]> = {
  down: [0.145, 0.535, 0.03], staff: [0.15, 0.6, 0.11], front: [0.05, 0.6, 0.13], chest: [0.06, 0.66, 0.13], raise: [0.175, 0.93, 0.08],
  high: [0.15, 1.02, 0.06], shield: [0.13, 0.6, 0.13], hip: [0.14, 0.565, -0.005], teach: [0.1, 0.75, 0.16], forward: [0.12, 0.68, 0.17],
};

interface Plan { right: Pose; left: Pose; props: ((kit: Kit, H: { R: Vector3; L: Vector3 }) => void)[] }
function planOf(f: FigureSpec, r: Rig): Plan {
  const era = f.era, s = r.s, R = f.roles2, t = f.tinctures;
  const metal = t.metal === '#f2eee5' ? P.C.silver : P.C.gold;
  switch (f.role) {
    case 'ruler': {
      if (R.has('rebel')) return { right: 'staff', left: 'down', props: [(k, H) => P.banner(k, H.R, f, s, -1)] };
      if (R.has('usurper')) return { right: 'staff', left: 'staff', props: [(k, H) => P.sceptre(k, H.R, era, s), (k, H) => P.sword(k, H.L, era, s, { down: true })] };
      return { right: 'staff', left: r.child ? 'down' : 'hip', props: [(k, H) => P.sceptre(k, H.R, era, s)] };
    }
    case 'regent': return { right: 'front', left: 'front', props: [(k, H) => P.heldSeal(k, f, H.R.clone().lerp(H.L, 0.5), s)] };
    case 'general': {
      const props: Plan['props'] = [];
      if (era <= 3) props.push((k, H) => P.shield(k, f, H.L, s));
      if (era <= 1) props.push((k, H) => P.spear(k, H.R, era, s));
      else if (era <= 4) props.push((k, H) => P.sword(k, H.R, era, s));
      else props.push((k, H) => P.rifle(k, H.R, era, s));
      if (era === 5) props.push((k) => P.scabbard(k, V(r.waistR * 1.2, r.waist - 0.01, -0.035 * s), era, s));
      return { right: 'staff', left: era <= 3 ? 'shield' : era === 4 ? 'hip' : 'down', props };
    }
    case 'president': return { right: 'chest', left: 'down', props: [(k, H) => P.charter(k, H.R, s, t.colour === '#28231f' ? P.C.wax : t.colour)] };
    case 'chairman': return { right: 'high', left: 'down', props: [(k, H) => P.torch(k, H.R, s)] };
    case 'merchant': return { right: 'forward', left: era >= 4 ? 'chest' : 'down', props: [(k, H) => P.scales(k, H.R, era, s), ...(era >= 4 ? [(k: Kit, H: { R: Vector3; L: Vector3 }) => P.ledger(k, H.L, s)] : [])] };
    case 'priest': return { right: 'staff', left: 'forward', props: [(k, H) => P.staff(k, H.R, s, era <= 1 ? 'knob' : 'crook', metal), (k, H) => P.censer(k, H.L, s, era === 0 ? P.C.bronze : P.C.gold)] };
    case 'prophet': return { right: 'staff', left: 'raise', props: [(k, H) => P.staff(k, H.R, s, 'star', metal)] };
    case 'philosopher': return { right: 'teach', left: 'chest', props: [(k, H) => P.book(k, V(H.L.x - 0.01 * s, H.L.y + 0.035 * s, H.L.z + 0.01 * s), s, t.colour)] };
    case 'scribe': case 'historian': case 'translator': {
      if (era <= 1) return { right: 'chest', left: 'chest', props: [(k, H) => P.tablet(k, H.L, s), (k, H) => P.stylus(k, H.R, s)] };
      if (f.role === 'translator') return { right: 'chest', left: 'chest', props: [(k, H) => P.book(k, V(H.L.x, H.L.y + 0.035 * s, H.L.z), s, t.colour), (k, H) => P.charter(k, H.R, s, t.metal)] };
      return { right: 'chest', left: 'chest', props: [(k, H) => P.writing(k, H.L.clone().lerp(H.R, 0.4), era, s), (k, H) => (era >= 5 ? P.stylus(k, H.R, s, '#1e1c1b') : P.quill(k, H.R, s))] };
    }
    case 'envoy': return { right: 'chest', left: 'down', props: [(k, H) => P.letter(k, H.R, f, s)] };
    case 'rebel': return { right: 'staff', left: 'down', props: [(k, H) => P.banner(k, H.R, f, s, -1)] };
    case 'inventor': {
      if (era <= 2) return { right: 'chest', left: 'front', props: [(k, H) => P.mallet(k, H.R, s), (k, H) => P.wheel(k, H.L, s)] };
      if (era <= 4) return { right: 'chest', left: 'chest', props: [(k, H) => P.dividers(k, H.R, s), (k, H) => P.setSquare(k, H.L, s)] };
      return { right: 'chest', left: 'front', props: [(k, H) => P.wrench(k, H.R, s), (k, H) => P.cogwheel(k, H.L, s)] };
    }
    case 'archaeologist': return { right: 'forward', left: 'chest', props: [(k, H) => P.trowel(k, H.R, s), (k, H) => P.brush(k, H.L, s)] };
    case 'usurper': return { right: 'staff', left: 'down', props: [(k, H) => P.sword(k, H.R, era, s)] };
    default: return { right: 'down', left: 'down', props: [] };
  }
}

/** Two-bone reach: the elbow, bent back and out, for a hand at H. */
function elbow(S: Vector3, H: Vector3, l1: number, l2: number, side: number): [Vector3, Vector3] {
  const d0 = H.clone().sub(S);
  const d = Math.min(d0.length(), (l1 + l2) * 0.995);
  const dir = d0.normalize();
  const hand = S.clone().addScaledVector(dir, d);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const pole = V(side * 0.55, -0.25, -1);
  pole.addScaledVector(dir, -pole.dot(dir)).normalize();
  return [S.clone().addScaledVector(dir, a).addScaledVector(pole, h), hand];
}

function arms(kit: Kit, f: FigureSpec, r: Rig, L: Look) {
  const s = r.s;
  const plan = planOf(f, r);
  const handAt = (pose: Pose, side: number) => {
    const [x, y, z] = HANDS[pose];
    // a child's arms are shorter: scale the reach about the shoulder
    return V(side * x * s * (r.fem ? 0.93 : 1), y * s, z * s);
  };
  const H = { R: handAt(plan.right, -1), L: handAt(plan.left, 1) };
  if (plan.right === 'front' && plan.left === 'front') { H.R.x = -0.045 * s; H.L.x = 0.045 * s; }
  const l1 = 0.155 * s, l2 = 0.15 * s;
  const sleeveCol = (side: number) => (side < 0 ? L.upper[0] : L.upper[1]);
  for (const side of [-1, 1]) {
    const S = V(side * r.shW, r.shoulder - 0.012 * s, -0.004);
    const want = side < 0 ? H.R : H.L;
    const [E, hand] = elbow(S, want, l1, l2, side);
    if (side < 0) H.R = hand; else H.L = hand;
    const armor = L.armour === 'mail' || L.armour === 'surcoat' ? '#8a9096' : null;
    const sleeve = armor ?? sleeveCol(side);
    const fin = armor ? 'metal' : 'paint';
    // shoulder, upper arm, forearm
    kit.add(ball(V(S.x * 0.96, S.y, S.z), 0.033 * s), sleeve, fin);
    const short = L.sleeves === 'short' && !armor;
    if (short) {
      // a short sleeve to above the elbow, a bare arm below it
      const M = S.clone().lerp(E, 0.55);
      kit.add(tube(S, M, 0.035 * s, 0.033 * s, 10), sleeve, fin);
      kit.add(tube(M, E, 0.028 * s, 0.026 * s, 10), SKIN);
      kit.add(ring(0.033 * s, 0.0045 * s, 14, 4), L.trim, isMetal(f.tinctures, L.trim) ? 'metal' : 'paint', mul(T(M.x, M.y, M.z), lookAlong(E.clone().sub(S))));
    } else kit.add(tube(S, E, 0.034 * s, 0.03 * s, 10), sleeve, fin);
    kit.add(ball(E, (short ? 0.026 : 0.03) * s), short ? SKIN : sleeve, short ? 'paint' : fin);
    kit.add(tube(E, hand, 0.028 * s, short ? 0.022 * s : 0.026 * s, 10), short ? SKIN : sleeve, short ? 'paint' : fin);
    if (!short) kit.add(tube(hand.clone().lerp(E, 0.22), hand.clone().lerp(E, 0.12), 0.029 * s, 0.029 * s, 10), armor ? '#8a9096' : L.trim, armor ? 'metal' : isMetal(f.tinctures, L.trim) ? 'metal' : 'paint');
    // the hand: a little mitten of bare wood
    kit.add(ball(hand, 0.026 * s, 0.9, 1.1, 1), SKIN);
    if (side > 0 && f.death === 'battle') P.armband(kit, S, E, 0.036 * s);
  }
  for (const p of plan.props) p(kit, H);
}
/** A rotation taking +y to direction d (for rings round a limb). */
function lookAlong(d: Vector3): Matrix4 {
  return new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().normalize()));
}

// ---------------------------------------------------------------- the head
function head(kit: Kit, f: FigureSpec, r: Rig, L: Look) {
  const s = r.s;
  const hr = r.headR;
  const c = V(0, r.head, 0.006 * s);
  // old age bows the head a little more
  kit.with(about(V(0, r.neck, 0), RX(r.stoop * 0.6)), () => {
    kit.add(tube(V(0, r.neck - 0.03 * s, 0), V(0, r.neck + 0.03 * s, 0.004), 0.026 * s, 0.024 * s, 10), SKIN);
    kit.add(ball(c, hr, 0.93, 1.06, 1, 18, 14), SKIN);
    hair(kit, f, r, L, c);
    headgear(kit, f, r, L, c);
  });
}

function hair(kit: Kit, f: FigureSpec, r: Rig, L: Look, c: Vector3) {
  const hr = r.headR, s = r.s;
  const covered = ['helmet', 'mitre', 'hood', 'veil', 'tophat', 'brim', 'skullcap'].includes(L.head);
  if (L.head === 'helmet' || L.head === 'hood') return;
  const col = L.hair;
  // a cap of hair, sitting back on the head
  // (kept wholly outside the head, so no wood shows through)
  const top = cap(hr * 1.1, 0, Math.PI * (r.fem ? 0.6 : 0.52), 18, 8);
  top.scale(0.95, 1.02, 1.02);
  kit.add(top, col, 'paint', mul(T(c.x, c.y + 0.001, c.z), RX(-0.42)));
  if (covered && L.head !== 'veil') return;
  if (L.hairStyle === 'long' && L.head !== 'veil') {
    // hair falling down the back
    kit.add(lathe([[hr * 0.98, c.y + hr * 0.2], [hr * 1.02, c.y - hr * 0.5], [hr * 0.95, r.neck - 0.02 * s], [hr * 0.85, r.shoulder - 0.05 * s]], 14, Math.PI * 0.55, Math.PI * 0.9).scale(1, 1, 0.9), col, 'paint', T(0, 0, c.z - 0.008 * s));
  }
  if (L.hairStyle === 'bun') kit.add(ball(V(c.x, c.y + hr * 0.25, c.z - hr * 0.95), hr * 0.42), col);
  if (L.hairStyle === 'bob') kit.add(lathe([[hr * 1.04, c.y + hr * 0.3], [hr * 1.07, c.y - hr * 0.3], [hr * 0.95, c.y - hr * 0.7]], 16, Math.PI * 0.45, Math.PI * 1.1), col, 'paint', T(0, 0, c.z - 0.004));
}

function headgear(kit: Kit, f: FigureSpec, r: Rig, L: Look, c: Vector3) {
  const hr = r.headR, s = r.s, era = f.era, t = f.tinctures;
  const brow = c.y + hr * 0.42;
  switch (L.head) {
    case 'crown': crown(kit, f, r, c); break;
    case 'circlet': kit.add(ring(hr * 0.98, 0.006 * s, 26, 5).scale(0.95, 1, 1.02), P.C.gold, 'metal', mul(T(c.x, brow, c.z), RX(-0.18))); break;
    case 'fillet': kit.add(ring(hr * 1.0, 0.0045 * s, 26, 4).scale(0.95, 1, 1.02), t.metal === '#f2eee5' ? P.C.silver : P.C.gold, 'metal', mul(T(c.x, brow - 0.004, c.z), RX(-0.15))); break;
    case 'veil': {
      const col = f.role === 'regent' || f.role === 'ruler' ? '#f2eee5' : era === 3 ? '#f2eee5' : shade(L.upper[1], 0.15);
      kit.add(lathe([[0.004, c.y + hr * 1.12], [hr * 0.75, c.y + hr * 0.95], [hr * 1.12, c.y + hr * 0.25], [hr * 1.12, c.y - hr * 0.6], [0.09 * s, r.neck - 0.02 * s], [0.12 * s, r.shoulder - 0.06 * s]], 24, Math.PI * 0.36, Math.PI * 1.28).scale(1, 1, 0.95), col, 'paint', T(0, 0, c.z - 0.004));
      if (f.role === 'regent') kit.add(ring(hr * 1.12, 0.005 * s, 26, 5).scale(0.95, 1, 1), P.C.gold, 'metal', mul(T(c.x, brow, c.z), RX(-0.2)));
      break;
    }
    case 'skullcap': kit.add(cap(hr * 1.07, 0, Math.PI * 0.36, 16, 5), f.role === 'priest' ? '#f2eee5' : shade(L.upper[0], -0.2), 'paint', T(c.x, c.y + 0.003, c.z)); break;
    case 'hood': {
      const col = shade(L.upper[0], -0.1);
      kit.add(lathe([[0.004, c.y + hr * 1.22], [hr * 0.85, c.y + hr * 1.0], [hr * 1.25, c.y + hr * 0.1], [hr * 1.2, c.y - hr * 0.7], [0.1 * s, r.shoulder - 0.0], [0.125 * s, r.shoulder - 0.05 * s]], 24, Math.PI * 0.3, Math.PI * 1.4).scale(1, 1, 0.98), col, 'paint', T(0, 0, c.z - 0.006));
      break;
    }
    case 'mitre': {
      const col = '#f2eee5';
      const g = lathe([[hr * 0.98, 0], [hr * 1.0, hr * 0.6], [hr * 0.7, hr * 1.4], [0.002, hr * 1.85]], 16);
      g.scale(1, 1, 0.55);
      kit.add(g, col, 'paint', T(c.x, brow - 0.01, c.z - 0.004));
      kit.add(box(V(c.x, brow + hr * 0.75, c.z + hr * 0.55), 0.012 * s, hr * 1.45, 0.004 * s), t.metal === '#f2eee5' ? P.C.silver : P.C.gold, 'metal');
      kit.add(ring(hr * 1.0, 0.006 * s, 20, 4).scale(1, 1, 0.58), t.metal === '#f2eee5' ? P.C.silver : P.C.gold, 'metal', T(c.x, brow - 0.006, c.z - 0.004));
      break;
    }
    case 'flatcap': {
      const col = shade(L.upper[0], -0.35);
      kit.add(cyl(hr * 1.25, hr * 1.25, 0.012 * s, 20), col, 'paint', mul(T(c.x, c.y + hr * 0.78, c.z - 0.004), RX(-0.12), RZ(0.12)));
      kit.add(cap(hr * 1.02, 0, Math.PI * 0.4, 16, 4), col, 'paint', T(c.x, c.y + 0.004, c.z));
      kit.add(ball(V(c.x + hr * 0.7, c.y + hr * 0.92, c.z + hr * 0.2), 0.012 * s, 0.6, 1.8, 0.6), '#efe9dc');
      break;
    }
    case 'tophat': {
      kit.add(cyl(hr * 1.5, hr * 1.5, 0.006 * s, 22).scale(1, 1, 0.9), '#1d1b1b', 'paint', T(c.x, c.y + hr * 0.6, c.z - 0.003));
      kit.add(cyl(hr * 0.88, hr * 0.94, hr * 1.6, 20).scale(1, 1, 0.9), '#1d1b1b', 'paint', T(c.x, c.y + hr * 0.6 + hr * 0.8, c.z - 0.003));
      kit.add(cyl(hr * 0.9, hr * 0.9, hr * 0.28, 20).scale(1, 1, 0.9), shade(t.colour, -0.2), 'paint', T(c.x, c.y + hr * 0.82, c.z - 0.003));
      break;
    }
    case 'brim': {
      const col = '#9c8259';
      kit.add(cyl(hr * 1.75, hr * 1.75, 0.006 * s, 24), col, 'paint', T(c.x, c.y + hr * 0.55, c.z - 0.002));
      kit.add(lathe([[hr * 1.0, 0], [hr * 0.95, hr * 0.6], [hr * 0.55, hr * 0.85], [0.002, hr * 0.8]], 18), col, 'paint', T(c.x, c.y + hr * 0.55, c.z - 0.002));
      kit.add(cyl(hr * 1.01, hr * 1.0, hr * 0.2, 18), '#3d2f22', 'paint', T(c.x, c.y + hr * 0.68, c.z - 0.002));
      break;
    }
    case 'helmet': helmet(kit, f, r, c); break;
  }
}

/** A crown by the age: a band with tall points; radiate spikes; a jewelled diadem; fleurons; arches over a cap. */
function crown(kit: Kit, f: FigureSpec, r: Rig, c: Vector3) {
  const hr = r.headR, s = r.s, era = f.era;
  const gold = P.C.gold;
  const y0 = c.y + hr * 0.5;
  const R0 = hr * 0.98;
  const band = (h: number) => kit.add(cyl(R0, R0 * 1.04, h, 28, true).scale(0.96, 1, 1), gold, 'metal', T(c.x, y0 + h / 2, c.z - 0.003));
  const jewel = (a: number, y: number, col: string, rad = 0.006) => kit.add(ball(V(c.x + Math.sin(a) * R0 * 1.04 * 0.96, y, c.z - 0.003 + Math.cos(a) * R0 * 1.04), rad * s, 1, 1, 0.6, 8, 6), col);
  const t = f.tinctures;
  const gem = t.colour === '#28231f' ? '#b3322a' : t.colour;
  switch (era) {
    case 0: {
      band(0.02 * s);
      for (let i = 0; i < 5; i++) { const a = -0.9 + (i / 4) * 1.8; kit.add(cone(0.011 * s, (i === 2 ? 0.075 : 0.05) * s, 6), gold, 'metal', T(c.x + Math.sin(a) * R0 * 0.96, y0 + 0.02 * s + (i === 2 ? 0.037 : 0.025) * s, c.z - 0.003 + Math.cos(a) * R0)); }
      jewel(0, y0 + 0.01 * s, gem);
      break;
    }
    case 1: {
      band(0.016 * s);
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; kit.add(cone(0.006 * s, 0.05 * s, 5), gold, 'metal', mul(T(c.x + Math.sin(a) * R0 * 0.96, y0 + 0.04 * s, c.z - 0.003 + Math.cos(a) * R0), RX(Math.cos(a) * 0.22), RZ(-Math.sin(a) * 0.22))); }
      break;
    }
    case 2: {
      band(0.03 * s);
      for (let i = 0; i < 8; i++) jewel((i / 8) * Math.PI * 2, y0 + 0.015 * s, i % 2 ? '#f2eee5' : gem, 0.0065);
      for (const side of [-1, 1]) for (let k = 0; k < 3; k++) kit.add(ball(V(c.x + side * R0 * 0.97, y0 - (0.012 + k * 0.016) * s, c.z), 0.0045 * s), '#f2eee5');
      break;
    }
    case 3: {
      band(0.022 * s);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = c.x + Math.sin(a) * R0 * 0.97, z = c.z - 0.003 + Math.cos(a) * R0;
        if (i % 2 === 0) { kit.add(cone(0.012 * s, 0.035 * s, 6), gold, 'metal', T(x, y0 + 0.038 * s, z)); kit.add(ball(V(x, y0 + 0.058 * s, z), 0.007 * s), gold, 'metal'); }
        else kit.add(ball(V(x, y0 + 0.028 * s, z), 0.006 * s), gold, 'metal');
      }
      jewel(0, y0 + 0.011 * s, gem);
      break;
    }
    default: {
      // a closed crown: a velvet cap under two arches, an orb and cross on top
      band(0.022 * s);
      kit.add(cap(R0 * 0.95, 0, Math.PI * 0.5, 18, 6).scale(1, 0.95, 1), shade(t.colour === '#d6a634' ? '#b3322a' : t.colour, -0.1), 'paint', T(c.x, y0 + 0.02 * s, c.z - 0.003));
      for (const rot of [0, Math.PI / 2]) kit.add(ring(R0 * 0.97, 0.0045 * s, 20, 4, Math.PI).rotateX(-Math.PI / 2), gold, 'metal', mul(T(c.x, y0 + 0.02 * s, c.z - 0.003), RY(rot)));
      kit.add(ball(V(c.x, y0 + 0.02 * s + R0 * 0.97 + 0.008 * s, c.z - 0.003), 0.01 * s), gold, 'metal');
      kit.add(rod(V(c.x, y0 + 0.02 * s + R0 + 0.014 * s, c.z - 0.003), V(c.x, y0 + 0.02 * s + R0 + 0.035 * s, c.z - 0.003), 0.003 * s, 5), gold, 'metal');
      for (let i = 0; i < 4; i++) jewel((i / 4) * Math.PI * 2, y0 + 0.011 * s, gem);
      break;
    }
  }
}

/** A helmet by the age: bronze with cheek-pieces; a crested helm; a spangenhelm with a nasal; the great helm; a
 *  morion; a shako; a steel helmet. */
function helmet(kit: Kit, f: FigureSpec, r: Rig, c: Vector3) {
  const hr = r.headR, s = r.s, era = f.era, t = f.tinctures;
  const metal = era === 0 ? P.C.bronze : P.C.steel;
  const crest = t.quarterly ? t.a : t.colour;
  switch (era) {
    case 0: {
      kit.add(lathe([[hr * 1.1, -hr * 0.1], [hr * 1.1, hr * 0.35], [hr * 0.85, hr * 0.95], [hr * 0.25, hr * 1.25], [0.002, hr * 1.32]], 18), metal, 'metal', T(c.x, c.y, c.z));
      for (const side of [-1, 1]) kit.add(box(V(c.x + side * hr * 0.88, c.y - hr * 0.35, c.z + hr * 0.25), 0.008 * s, hr * 0.85, hr * 0.7, 0.003 * s), metal, 'metal', about(V(c.x + side * hr * 0.88, c.y, c.z), RZ(side * 0.12)));
      kit.add(ball(V(c.x, c.y + hr * 1.32, c.z), 0.01 * s), metal, 'metal');
      break;
    }
    case 1: {
      kit.add(lathe([[hr * 1.1, -hr * 0.4], [hr * 1.12, hr * 0.3], [hr * 0.88, hr * 0.95], [0.002, hr * 1.18]], 18), metal, 'metal', T(c.x, c.y, c.z));
      for (const side of [-1, 1]) kit.add(box(V(c.x + side * hr * 0.75, c.y - hr * 0.45, c.z + hr * 0.55), 0.008 * s, hr * 0.8, hr * 0.5, 0.003 * s), metal, 'metal', about(V(c.x, c.y, c.z), RY(side * -0.35)));
      // a horsehair crest from brow to nape
      const sh = new Shape();
      sh.moveTo(-hr * 1.15, 0); sh.quadraticCurveTo(-hr * 1.1, hr * 0.9, 0, hr * 1.0); sh.quadraticCurveTo(hr * 1.2, hr * 1.0, hr * 1.35, -hr * 0.6); sh.lineTo(hr * 1.1, -hr * 0.6); sh.quadraticCurveTo(hr * 0.9, hr * 0.5, 0, hr * 0.55); sh.quadraticCurveTo(-hr * 0.8, hr * 0.5, -hr * 0.85, 0); sh.closePath();
      kit.add(slab(sh, 0.018 * s, 0.003 * s), crest, 'paint', mul(T(c.x, c.y + hr * 0.62, c.z), RY(Math.PI / 2)));
      break;
    }
    case 2: {
      kit.add(lathe([[hr * 1.1, -hr * 0.05], [hr * 1.1, hr * 0.25], [hr * 0.6, hr * 1.05], [0.002, hr * 1.55]], 16), metal, 'metal', T(c.x, c.y, c.z));
      kit.add(ring(hr * 1.1, 0.006 * s, 20, 4), P.C.brass, 'metal', T(c.x, c.y + hr * 0.05, c.z));
      kit.add(box(V(c.x, c.y - hr * 0.2, c.z + hr * 1.08), 0.012 * s, hr * 0.75, 0.006 * s, 0.002 * s), metal, 'metal');
      break;
    }
    case 3: {
      // the great helm, with a torse (a wreath twisted of the wearer's two tinctures)
      kit.add(lathe([[hr * 1.15, -hr * 0.95], [hr * 1.15, hr * 0.6], [hr * 1.0, hr * 0.95], [0.002, hr * 1.0]], 18), metal, 'metal', T(c.x, c.y, c.z));
      kit.add(box(V(c.x, c.y + hr * 0.12, c.z + hr * 1.06), hr * 1.6, 0.008 * s, 0.01 * s), '#151413');
      kit.add(box(V(c.x, c.y - hr * 0.2, c.z + hr * 1.12), 0.008 * s, hr * 1.3, 0.008 * s), shade(metal, -0.25), 'metal');
      const n = 12;
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; kit.add(ball(V(c.x + Math.sin(a) * hr * 0.95, c.y + hr * 1.02, c.z + Math.cos(a) * hr * 0.95), 0.013 * s, 1, 0.8, 1, 8, 6), i % 2 ? t.metal : t.colour); }
      break;
    }
    case 4: {
      kit.add(lathe([[hr * 1.05, -hr * 0.05], [hr * 1.05, hr * 0.3], [hr * 0.75, hr * 1.0], [0.002, hr * 1.12]], 18), metal, 'metal', T(c.x, c.y + hr * 0.1, c.z));
      // the brim, swept up front and back
      const b = lathe([[hr * 1.05, 0], [hr * 1.7, 0.004 * s], [hr * 1.72, 0.012 * s]], 24);
      const p = b.getAttribute('position');
      for (let i = 0; i < p.count; i++) { const z = p.getZ(i); p.setY(i, p.getY(i) + Math.max(0, Math.abs(z) - hr) * 0.9); }
      b.computeVertexNormals();
      b.scale(0.75, 1, 1.15);
      kit.add(b, metal, 'metal', T(c.x, c.y + hr * 0.12, c.z));
      // the comb
      const sh = new Shape();
      sh.moveTo(-hr * 0.9, 0); sh.quadraticCurveTo(0, hr * 0.85, hr * 0.9, 0); sh.closePath();
      kit.add(slab(sh, 0.006 * s), metal, 'metal', mul(T(c.x, c.y + hr * 0.95, c.z), RY(Math.PI / 2)));
      kit.add(ball(V(c.x, c.y + hr * 1.6, c.z - hr * 0.5), 0.02 * s, 1, 1.8, 1), crest);
      break;
    }
    case 5: {
      // a shako with a peak and a pompom in the state's metal
      const col = '#1f1d1c';
      kit.add(cyl(hr * 0.98, hr * 1.12, hr * 1.25, 20).scale(1, 1, 0.95), col, 'paint', T(c.x, c.y + hr * 0.95, c.z - 0.002));
      kit.add(cyl(hr * 1.13, hr * 1.13, 0.008 * s, 20).scale(1, 1, 0.95), P.C.brass, 'metal', T(c.x, c.y + hr * 1.56, c.z - 0.002));
      kit.add(cap(hr * 1.0, Math.PI * 0.5, Math.PI * 0.62, 16, 2, -Math.PI * 0.45, Math.PI * 0.9).scale(1, 0.3, 1.25), '#141312', 'paint', T(c.x, c.y + hr * 0.42, c.z + 0.004));
      kit.add(slab(starShape(8, 0.017 * s, 0.009 * s), 0.004 * s), P.C.brass, 'metal', T(c.x, c.y + hr * 1.05, c.z + hr * 1.09));
      kit.add(ball(V(c.x, c.y + hr * 1.75, c.z + hr * 0.85), 0.017 * s), t.metal);
      break;
    }
    default: {
      // a steel helmet: a dome over a flared brim, painted field grey
      const col = mixHex(t.quarterly ? t.a : t.colour, '#5d6247', 0.75);
      kit.add(lathe([[hr * 1.55, hr * 0.05], [hr * 1.45, hr * 0.12], [hr * 1.12, hr * 0.25], [hr * 1.05, hr * 0.7], [hr * 0.6, hr * 1.2], [0.002, hr * 1.3]], 22), col, 'paint', T(c.x, c.y, c.z));
      kit.add(rod(V(c.x - hr * 0.9, c.y - hr * 0.3, c.z + hr * 0.2), V(c.x + hr * 0.9, c.y - hr * 0.3, c.z + hr * 0.2), 0.003 * s, 4), '#4a3e2c');
      break;
    }
  }
}

/** A fingerprint of a built piece (every vertex and colour), to check that the same person is the same piece. */
export function fingerprint(g: Group): string {
  let h = 0x811c9dc5;
  g.traverse((o) => {
    const m = o as import('three').Mesh;
    if (!m.isMesh || !m.geometry) return;
    for (const k of ['position', 'color']) {
      const a = m.geometry.getAttribute(k);
      if (!a) continue;
      const arr = a.array as Float32Array;
      const u = new Uint32Array(arr.buffer, arr.byteOffset, arr.length);
      for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 0x01000193);
    }
    h = Math.imul(h ^ m.name.length, 0x01000193);
  });
  return (h >>> 0).toString(16).padStart(8, '0');
}
