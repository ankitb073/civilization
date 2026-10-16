// Procedural heraldry: a coat of arms for every state, city and faith, and a seal for every person, drawn as SVG
// from what the record says they were. The engine reads the record into an ArmsSpec or SigilSpec
// (engine/src/export/deck.ts); this module only draws. Both are pure: the same spec always draws the same arms, and
// the only "chance" is a hash of the id, so a state's arms are the same on its page, on its cards and anywhere else.
//
// Arms: the shield's shape is the age of the founding; the colour is the people's (every state of one people shares
// it), the metal is the faith's; the division comes from the id; the charge is what the state was (a tower for a
// city-state, a ship for a sea power, a crown for a kingdom, a star for a theocracy, a gear for an industrial state…).
// The rule of tincture holds throughout: metal is never laid on metal nor colour on colour (charges that cross a
// division are counterchanged).
//
// Seals: round for men, a lozenge for women (as in real heraldry); quarterly in their state's colour and metal for
// members of a ruling house, a plain field within a bordure otherwise; a charge for the highest role they held (a
// crown for rulers, crossed swords for generals, a scroll for scribes, scales or a ship for merchants…), and their
// initial, cut in the letters of their age.
import type { ArmsSpec, SigilSpec } from '../../engine/src/export/contract.ts';
import { ARMS_COLONY, ARMS_HORDE, ARMS_INDUSTRIAL, ARMS_NAVAL, ARMS_REBEL } from '../../engine/src/export/contract.ts';

// ---------------------------------------------------------------- tinctures
interface Tincture { name: string; fill: string; metal: boolean }
const METALS: Tincture[] = [
  { name: 'Or', fill: '#d6a634', metal: true },
  { name: 'Argent', fill: '#f2eee5', metal: true },
];
const COLOURS: Tincture[] = [
  { name: 'Gules', fill: '#b3322a', metal: false },
  { name: 'Azure', fill: '#27589b', metal: false },
  { name: 'Vert', fill: '#2c7847', metal: false },
  { name: 'Purpure', fill: '#6a3c88', metal: false },
  { name: 'Sable', fill: '#28231f', metal: false },
];
const LINE = '#241c15';

/** FNV-1a with an avalanche: a stable 32-bit hash of a string. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
const colourOf = (culture: number) => COLOURS[hash(`cul:${culture}`) % COLOURS.length];
const metalOf = (religion: number, id: string) => METALS[hash(religion >= 0 ? `mov:${religion}` : `none:${id}`) % METALS.length];

// ---------------------------------------------------------------- geometry helpers
const f = (n: number) => String(Math.round(n * 10) / 10);
function circle(cx: number, cy: number, r: number, ccw = false): string {
  const s = ccw ? 1 : 0;
  return `M${f(cx - r)} ${f(cy)}a${f(r)} ${f(r)} 0 1 ${s} ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 ${s} ${f(-2 * r)} 0Z`;
}
function star(cx: number, cy: number, n: number, ro: number, ri: number, rot = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < 2 * n; i++) {
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    const r = i % 2 ? ri : ro;
    pts.push(`${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`);
  }
  return `M${pts.join('L')}Z`;
}
/** A closed shape from the points of its left half, top to bottom on the axis, mirrored about x = 50. */
function sym(pts: [number, number][]): string {
  const right = pts.slice(1, -1).reverse().map(([x, y]) => [100 - x, y] as [number, number]);
  return `M${[...pts, ...right].map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;
}
/** A thick open ring along a stadium (a chain link), with a gap from t0 to t1 (fractions of its perimeter). */
function link(cx: number, cy: number, hl: number, r: number, w: number, rot: number, gap: [number, number] | null): string {
  const per = 4 * hl + 2 * Math.PI * r;
  const at = (t: number): [number, number, number, number] => {
    let d = ((t % 1) + 1) % 1 * per;
    let x: number, y: number, nx: number, ny: number;
    if (d < 2 * hl) { x = -hl + d; y = -r; nx = 0; ny = -1; }
    else if ((d -= 2 * hl) < Math.PI * r) { const a = -Math.PI / 2 + d / r; x = hl + r * Math.cos(a); y = r * Math.sin(a); nx = Math.cos(a); ny = Math.sin(a); }
    else if ((d -= Math.PI * r) < 2 * hl) { x = hl - d; y = r; nx = 0; ny = 1; }
    else { d -= 2 * hl; const a = Math.PI / 2 + d / r; x = -hl + r * Math.cos(a); y = r * Math.sin(a); nx = Math.cos(a); ny = Math.sin(a); }
    const c = Math.cos((rot * Math.PI) / 180), s = Math.sin((rot * Math.PI) / 180);
    return [cx + x * c - y * s, cy + x * s + y * c, nx * c - ny * s, nx * s + ny * c];
  };
  const N = 72;
  if (!gap) {
    const outer: string[] = [], inner: string[] = [];
    for (let i = 0; i < N; i++) { const [x, y, nx, ny] = at(i / N); outer.push(`${f(x + nx * w / 2)} ${f(y + ny * w / 2)}`); inner.push(`${f(x - nx * w / 2)} ${f(y - ny * w / 2)}`); }
    return `M${outer.join('L')}ZM${inner.reverse().join('L')}Z`;
  }
  const [g0, g1] = gap;
  const span = ((g0 - g1) % 1 + 1) % 1;
  const outer: string[] = [], inner: string[] = [];
  for (let i = 0; i <= N; i++) { const [x, y, nx, ny] = at(g1 + (span * i) / N); outer.push(`${f(x + nx * w / 2)} ${f(y + ny * w / 2)}`); inner.push(`${f(x - nx * w / 2)} ${f(y - ny * w / 2)}`); }
  return `M${outer.join('L')}L${inner.reverse().join('L')}Z`;
}
function gear(cx: number, cy: number, teeth: number, ro: number, rr: number, hole: number): string {
  const pts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * 2 * Math.PI, step = (2 * Math.PI) / teeth;
    for (const [da, r] of [[0, rr], [0.12, ro], [0.38, ro], [0.5, rr]] as [number, number][]) {
      const a = a0 + da * step;
      pts.push(`${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`);
    }
    for (const da of [0.75]) { const a = a0 + da * step; pts.push(`${f(cx + rr * Math.cos(a))} ${f(cy + rr * Math.sin(a))}`); }
  }
  return `M${pts.join('L')}Z${circle(cx, cy, hole, true)}`;
}
/** The open sectors between a wheel's spokes, cut from its disc. */
function wheel(cx: number, cy: number, ro: number, rim: number, hub: number, spokes: number): string {
  let d = circle(cx, cy, ro);
  const half = 7 / 2;
  for (let i = 0; i < spokes; i++) {
    const a0 = (i * 360) / spokes + half / (Math.PI * hub) * 180 / 1.6, a1 = ((i + 1) * 360) / spokes - half / (Math.PI * hub) * 180 / 1.6;
    const p = (r: number, a: number) => `${f(cx + r * Math.cos((a * Math.PI) / 180))} ${f(cy + r * Math.sin((a * Math.PI) / 180))}`;
    const b0 = (i * 360) / spokes + (half / rim) * 180 / Math.PI, b1 = ((i + 1) * 360) / spokes - (half / rim) * 180 / Math.PI;
    d += `M${p(hub, a0)}L${p(rim, b0)}A${rim} ${rim} 0 0 1 ${p(rim, b1)}L${p(hub, a1)}A${hub} ${hub} 0 0 0 ${p(hub, a0)}Z`;
  }
  return d;
}

// ---------------------------------------------------------------- charges (drawn in a 100 × 100 box)
interface Part { d: string; t?: string }
interface Charge { name: string; parts: Part[] }
const P = (d: string, t?: string): Part => ({ d, t });

const CROWN: Part[] = [P(`M12 82L6 36L28 54L50 22L72 54L94 36L88 82Z${circle(6, 28, 5.5)}${circle(50, 14, 6.5)}${circle(94, 28, 5.5)}M12 86H88V97H12Z${circle(31, 91.5, 3, true)}${circle(50, 91.5, 3, true)}${circle(69, 91.5, 3, true)}`)];
const IMPERIAL: Part[] = [P(`M14 80C13 54 28 40 50 38C72 40 87 54 86 80ZM30 76C30 62 35 53 44 48V76ZM70 76C70 62 65 53 56 48V76Z${circle(50, 30, 7)}M47 5H53V11H59V16H53V22.5H47V16H41V11H47ZM14 84H86V96H14Z${circle(30, 90, 3, true)}${circle(50, 90, 3, true)}${circle(70, 90, 3, true)}`)];
const EAGLE: Part[] = [P(sym([[50, 22], [46, 14], [41, 9], [35, 9.5], [29, 14], [35, 16], [39, 19], [41, 26], [36, 31], [26, 24], [14, 15], [3, 14], [9, 22], [2, 27], [11, 32], [4, 38], [15, 42], [9, 48], [22, 50], [33, 46], [38, 55], [37, 66], [28, 73], [31, 78], [40, 72], [43, 80], [36, 93], [45, 89], [50, 96]]) + circle(39, 13, 1.6, true) + circle(61, 13, 1.6, true))];
/** A lion's face: a swirling mane of tufts (unlike the sun's straight rays) around the face, its features cut out. */
function mane(cx: number, cy: number, n: number, ro: number, ri: number): string {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 2 * Math.PI - Math.PI / 2, a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2, tip = a0 + 0.8 * (a1 - a0);
    const p = (r: number, a: number) => `${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`;
    d += `${i ? 'L' : 'M'}${p(ri, a0)}Q${p(ro * 0.9, a0 + 0.1 * (a1 - a0))} ${p(ro, tip)}Q${p(ro * 0.78, a1 - 0.05 * (a1 - a0))} ${p(ri, a1)}`;
  }
  return `${d}Z`;
}
const LION: Part[] = [P(`${mane(50, 52, 13, 48, 33)}${circle(50, 52, 31, true)}${circle(50, 52, 28)}M34 47Q40 41 46 47Q40 50 34 47ZM54 47Q60 41 66 47Q60 50 54 47ZM44 56H56L50 64ZM39 70Q50 78 61 70Q50 73 39 70Z`)];
const ORB: Part[] = [P(`${circle(50, 61, 30)}M22 56H78V61.5H22ZM47.5 61.5H52.5V88H47.5ZM47 5H53V13H60V19H53V30.5H47V19H40V13H47Z`)];
const TOWER: Part[] = [P('M22 14H33V22H44V14H56V22H67V14H78V40H72V94H28V40H22ZM42 94V79A8 8 0 0 1 58 79V94ZM46 50H54V63H46Z')];
const CASTLE: Part[] = [P('M8 94V30H13V24H19V30H22V24H27V30H32V46H36V18H40V12H46V18H54V12H60V18H64V46H68V30H73V24H78V30H81V24H87V30H92V94ZM40 94V78A10 10 0 0 1 60 78V94ZM17 42H23V54H17ZM77 42H83V54H77ZM47 28H53V40H47Z')];
const GALLEY: Part[] = [
  P('M4 66H96C90 80 74 88 50 88C26 88 10 80 4 66Z'),
  P(`M26 18C40 15.5 60 15.5 74 18C78 32 78 46 72 58C58 55.5 42 55.5 28 58C22 46 22 32 26 18Z${circle(50, 37, 7.5, true)}`),
  P('M48 5H52V16H48ZM52 5L66 8L52 11ZM48 57.5H52V66H48Z'),
];
const CARAVEL: Part[] = [
  P('M4 60H16L18 66H80L84 54H97L92 72C84 85 68 90 50 90C30 90 13 84 4 60Z'),
  P('M28 23C41 21 53 21 64 23C66 35 66 45 62 55C52 53 41 53 31 55C27 45 26 35 28 23ZM44.5 29H47.5V37H55V40H47.5V49H44.5V40H37V37H44.5Z'),
  P('M33 9C41 8 51 8 59 9C60 13 60 16 58 19.5C51 18.6 42 18.6 35 19.5C33 16 32 13 33 9Z'),
  P('M75 12L91 50H71Z'),
  P('M44.5 2H47.5V8.5H44.5ZM47.5 2L58 4.5L47.5 7ZM44.5 55H47.5V66H44.5Z'),
];
const STEAMER: Part[] = [
  P(`M3 64H97L91 80C81 86 66 88 50 88C34 88 19 86 9 80Z${circle(28, 73, 2.6, true)}${circle(40, 73, 2.6, true)}${circle(52, 73, 2.6, true)}${circle(64, 73, 2.6, true)}${circle(76, 73, 2.6, true)}`),
  P('M22 49H76V64H22ZM27 53H33V58H27ZM37 53H43V58H37ZM47 53H53V58H47ZM57 53H63V58H57ZM67 53H72V58H67Z'),
  P('M33 25H44V49H33ZM54 25H65V49H54Z'),
  P('M35 22C29 20 29 12 35 11C37 4 47 4 50 9C56 5 64 8 62 14C67 18 61 24 55 21C51 25 41 25 35 22Z'),
];
const TREE: Part[] = [P(`${circle(50, 32, 22)}${circle(29, 47, 16)}${circle(71, 47, 16)}${circle(50, 54, 18)}`), P('M45 60H55V84C58 89 63 93 70 96H30C37 93 42 89 45 84Z')];
const SWORD: Part[] = [P('M45.5 10L50 2L54.5 10V64H45.5ZM49 13H51V59H49Z'), P('M28 64H72V71.5H28Z'), P(`M46.5 71.5H53.5V88H46.5Z${circle(50, 93, 5.5)}`)];
const STAR6: Part[] = [P(star(50, 52, 6, 46, 22))];
const STAR8: Part[] = [P(star(50, 52, 8, 46, 21))];
const STAR5: Part[] = [P(star(50, 54, 5, 46, 19))];
const SUN: Part[] = [P(`${star(50, 50, 16, 47, 25, -90).replace(/L/g, 'L')}${circle(50, 50, 18, true)}${circle(50, 50, 13)}`)];
const WHEEL: Part[] = [P(wheel(50, 50, 42, 33, 10, 8))];
const CRESCENT: Part[] = [P('M21.9 33.5A36 36 0 1 0 78.1 33.5A30 30 0 1 1 21.9 33.5Z')];
const GEAR: Part[] = [P(gear(50, 50, 10, 45, 35, 13))];
const COLUMN: Part[] = [P('M26 10H74V17H26ZM31 17H69C66 19 65 21 65 25H35C35 21 34 19 31 17ZM37 25H63V84H37ZM41.5 29H44.5V80H41.5ZM48.5 29H51.5V80H48.5ZM55.5 29H58.5V80H55.5ZM32 84H68V90H32ZM27 90H73V97H27Z')];
const TORCH: Part[] = [P('M50 3C58 15 68 21 64 33C62 39 56 41 50 41C44 41 38 39 36 33C34 25 42 21 44 13C46 19 48 21 50 19C52 15 50 9 50 3Z'), P('M34 43H66L59 53H41Z'), P('M43 55H57L53 96H47Z')];
const STARRING: Part[] = [P(Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * 2 * Math.PI - Math.PI / 2; return star(50 + 34 * Math.cos(a), 52 + 34 * Math.sin(a), 5, 10, 4); }).join('') + star(50, 52, 5, 14, 5.6))];
const ANCHOR: Part[] = [P(`${circle(50, 13, 8)}${circle(50, 13, 4, true)}`), P('M30 27H70V34H30Z'), P('M46.5 21H53.5V84H46.5Z'), P('M16 60L9 65L21 48L31 61L24 60.5C28 73 38 81 50 82C62 81 72 73 76 60.5L69 61L79 48L91 65L84 60C80 80 66 92 50 92C34 92 20 80 16 60Z')];
const KEY: Part[] = [P(`${circle(50, 20, 15)}${circle(50, 20, 7.5, true)}M46 35H54V92H46ZM54 68H67V75H61V80H67V87H54Z`)];
const FLEUR: Part[] = [
  P('M50 4C59 16 63 30 57 47H43C37 30 41 16 50 4Z'),
  P('M41 47C31 50 17 44 15 32C13 22 22 16 30 21C23 24 22 33 29 38C33 41 37 42 41 42Z'),
  P('M59 47C69 50 83 44 85 32C87 22 78 16 70 21C77 24 78 33 71 38C67 41 63 42 59 42Z'),
  P('M28 49H72V57H28Z'),
  P('M44 57H56L57 75C57 83 54 89 50 95C46 89 43 83 43 75Z'),
  P('M42 59C34 62 26 70 28 82C31 76 36 70 43 67Z'),
  P('M58 59C66 62 74 70 72 82C69 76 64 70 57 67Z'),
];
const ROSE: Part[] = [P([0, 1, 2, 3, 4].map((i) => { const a = (i / 5) * 2 * Math.PI - Math.PI / 2; return circle(50 + 21 * Math.cos(a), 52 + 21 * Math.sin(a), 17); }).join('') + circle(50, 52, 16)), P([0, 1, 2, 3, 4].map((i) => { const a = ((i + 0.5) / 5) * 2 * Math.PI - Math.PI / 2; const x = 50 + 40 * Math.cos(a), y = 52 + 40 * Math.sin(a); const b = 50 + 30 * Math.cos(a - 0.18), c = 52 + 30 * Math.sin(a - 0.18), d = 50 + 30 * Math.cos(a + 0.18), e = 52 + 30 * Math.sin(a + 0.18); return `M${f(b)} ${f(c)}L${f(x)} ${f(y)}L${f(d)} ${f(e)}Z`; }).join(''))];
const LABEL: Part[] = [P('M8 8H92V17H8ZM18 17H30L32 34H16ZM44 17H56L58 34H42ZM70 17H82L84 34H68Z')];
const SCROLL: Part[] = [P('M20 10H80A7 7 0 0 1 80 24H20A7 7 0 0 1 20 10ZM26 24H74V78H26ZM20 78H80A7 7 0 0 1 80 92H20A7 7 0 0 1 20 78ZM32 33H68V36.5H32ZM32 42H68V45.5H32ZM32 51H62V54.5H32ZM32 60H66V63.5H32ZM32 69H55V72.5H32Z')];
const BOOK: Part[] = [P('M49 28C39 21 23 19 7 24V82C23 77 39 79 49 86ZM51 28C61 21 77 19 93 24V82C77 77 61 79 51 86ZM14 34C24 31 34 32 42 36V39C34 35 24 34 14 37ZM14 46C24 43 34 44 42 48V51C34 47 24 46 14 49ZM14 58C24 55 34 56 42 60V63C34 59 24 58 14 61ZM86 34C76 31 66 32 58 36V39C66 35 76 34 86 37ZM86 46C76 43 66 44 58 48V51C66 47 76 46 86 49ZM86 58C76 55 66 56 58 60V63C66 59 76 58 86 61Z')];
const SCALES: Part[] = [P(`${circle(50, 22, 5)}M12 29H88V34.5H12Z`), P('M47.5 34.5H52.5V86H47.5ZM32 86H68V94H32Z'), P('M17 34.5H19.5L32 61H29.5ZM17 34.5H19.5L7 61H4.5Z'), P('M80.5 34.5H83L95.5 61H93ZM80.5 34.5H83L70.5 61H68Z'), P('M2 61H35C35 69 28 74 18.5 74C9 74 2 69 2 61Z'), P('M65 61H98C98 69 91 74 81.5 74C72 74 65 69 65 61Z')];
const DOVE: Part[] = [P(`M10 52C18 44 29 43 37 47L44 29C48 17 58 9 71 7C65 17 63 25 63 33C71 29 81 29 90 33C81 37 73 43 67 50C71 54 75 58 77 65C67 63 59 61 53 61C45 67 34 69 24 65L15 63L21 58C17 57 13 55 10 52Z${circle(18, 51, 1.8, true)}`), P('M10 54L2 58C6 62 12 62 16 58ZM6 60C4 64 6 68 10 68C10 64 9 62 6 60Z')];
const CHALICE: Part[] = [P(circle(50, 8, 5.5)), P('M26 16H74C74 36 63 48 54.5 50V71C54.5 75 62 79 71 81V90H29V81C38 79 45.5 75 45.5 71V50C37 48 26 36 26 16Z')];
const PRESS: Part[] = [P('M16 6H84V17H16ZM20 17H29V91H20ZM71 17H80V91H71ZM10 91H90V98H10Z'), P('M46.5 17H53.5V44H46.5Z'), P('M30 28H70V33H30Z'), P('M34 44H66V53H34ZM29 66H71V73H29Z')];
const SWORDS: Part[] = [{ d: SWORD.map((p) => p.d).join(''), t: 'rotate(-38 50 50) translate(0 2)' }, { d: SWORD.map((p) => p.d).join(''), t: 'rotate(38 50 50) translate(0 2)' }];
const CHAIN: Part[] = [P(link(30, 52, 9, 13, 8, -35, [0.62, 0.7])), P(link(70, 48, 9, 13, 8, -35, [0.12, 0.2])), P('M45 37L49 31L51 38ZM53 64L58 70L51 67ZM47 59L41 66L46 61Z')];

/** A horse's head: one outline, its mane cut in steps along the neck. */
const HORSE_D: Part[] = [P(`M68 95H26C24 85 29 76 35 69C30 69 26 71 22 73C15 75 9 70 12 63C15 56 21 50 25 42C29 30 39 21 51 18L55 6L60 18C66 19 72 22 76 27L90 38C94 42 92 48 86 50C80 50 76 48 72 50C70 56 70 62 72 68C76 76 73 86 68 95Z${circle(60, 30, 3, true)}M46 24L43 29L46 29L42 35L45 35L40 41L43 41L38 47L41 47L36 53L44 52L50 21Z`)];

const CHARGES: Record<string, Charge> = {
  crown: { name: 'a crown', parts: CROWN },
  imperial: { name: 'an imperial crown', parts: IMPERIAL },
  eagle: { name: 'an eagle displayed', parts: EAGLE },
  lion: { name: 'a lion’s face', parts: LION },
  orb: { name: 'an orb', parts: ORB },
  tower: { name: 'a tower', parts: TOWER },
  castle: { name: 'a castle', parts: CASTLE },
  galley: { name: 'a galley', parts: GALLEY },
  caravel: { name: 'a ship under sail', parts: CARAVEL },
  steamer: { name: 'a steamship', parts: STEAMER },
  horse: { name: 'a horse’s head', parts: HORSE_D },
  tree: { name: 'a tree', parts: TREE },
  sword: { name: 'a sword', parts: SWORD },
  swords: { name: 'two swords in saltire', parts: SWORDS },
  star6: { name: 'a mullet of six points', parts: STAR6 },
  star8: { name: 'a mullet of eight points', parts: STAR8 },
  star5: { name: 'a mullet', parts: STAR5 },
  sun: { name: 'a sun in splendour', parts: SUN },
  wheel: { name: 'a wheel', parts: WHEEL },
  crescent: { name: 'a crescent', parts: CRESCENT },
  gear: { name: 'a cogwheel', parts: GEAR },
  column: { name: 'a column', parts: COLUMN },
  torch: { name: 'a torch', parts: TORCH },
  stars: { name: 'nine mullets in annulo', parts: STARRING },
  anchor: { name: 'an anchor', parts: ANCHOR },
  key: { name: 'a key', parts: KEY },
  fleur: { name: 'a fleur-de-lis', parts: FLEUR },
  rose: { name: 'a rose', parts: ROSE },
  label: { name: 'a label', parts: LABEL },
  scroll: { name: 'a scroll', parts: SCROLL },
  book: { name: 'a book', parts: BOOK },
  scales: { name: 'a pair of scales', parts: SCALES },
  dove: { name: 'a dove', parts: DOVE },
  chalice: { name: 'a chalice', parts: CHALICE },
  press: { name: 'a printing press', parts: PRESS },
  chain: { name: 'a chain broken', parts: CHAIN },
};

// ---------------------------------------------------------------- shields
interface Shield { d: string; cx: number; cy: number; size: number; name: string }
/** One shape per age (meta.eras): the round shield of the Bronze Age to the badge of the Age of Networks. */
const SHIELDS: Shield[] = [
  { name: 'a round shield', d: `M2 60A48 48 0 1 0 98 60A48 48 0 1 0 2 60Z`, cx: 50, cy: 60, size: 58 },
  { name: 'an oval shield', d: `M8 60A42 56 0 1 0 92 60A42 56 0 1 0 8 60Z`, cx: 50, cy: 60, size: 56 },
  { name: 'a long shield', d: 'M14 4Q50 -1 86 4Q95 60 86 116Q50 121 14 116Q5 60 14 4Z', cx: 50, cy: 60, size: 60 },
  { name: 'a heater shield', d: 'M5 4H95V46C95 81 74 103 50 117C26 103 5 81 5 46Z', cx: 50, cy: 50, size: 58 },
  { name: 'an Iberian shield', d: 'M5 4H95V70A45 45 0 0 1 5 70Z', cx: 50, cy: 55, size: 60 },
  { name: 'a French shield', d: 'M5 4H95V88Q95 104 77 104H63Q53 104 50 117Q47 104 37 104H23Q5 104 5 88Z', cx: 50, cy: 54, size: 60 },
  { name: 'a badge', d: 'M50 3L95 22V78Q95 100 50 117Q5 100 5 78V22Z', cx: 50, cy: 58, size: 56 },
];
const VESICA: Shield = { name: 'a vesica seal', d: 'M50 2C86 30 86 90 50 118C14 90 14 30 50 2Z', cx: 50, cy: 60, size: 46 };

// ---------------------------------------------------------------- divisions
/** Region B of the field (drawn in the second tincture), how the charge sits, and its blazon. */
interface Division { id: string; w: number; b: string; kind: 'plain' | 'party' | 'ordinary' | 'chief' | 'bordure' | 'base'; name: string }
const rot = (deg: number, body: string) => `<g transform="rotate(${deg} 50 60)">${body}</g>`;
const DIVISIONS: Division[] = [
  { id: 'plain', w: 15, kind: 'plain', name: '', b: '' },
  { id: 'pale', w: 9, kind: 'party', name: 'Per pale', b: '<rect x="50" y="-10" width="60" height="140"/>' },
  { id: 'fess', w: 9, kind: 'party', name: 'Per fess', b: '<rect x="-10" y="58" width="120" height="70"/>' },
  { id: 'quarterly', w: 7, kind: 'party', name: 'Quarterly', b: '<rect x="50" y="-10" width="60" height="68"/><rect x="-10" y="58" width="60" height="70"/>' },
  { id: 'bend', w: 7, kind: 'party', name: 'Per bend', b: '<path d="M-10 -12L112 134H-10Z"/>' },
  { id: 'bendsin', w: 4, kind: 'party', name: 'Per bend sinister', b: '<path d="M110 -12L-12 134H110Z"/>' },
  { id: 'chevron', w: 6, kind: 'party', name: 'Per chevron', b: '<path d="M-10 112L50 46L110 112V130H-10Z"/>' },
  { id: 'saltire', w: 4, kind: 'party', name: 'Per saltire', b: '<path d="M-10 -12H110L50 60ZM-10 132H110L50 60Z"/>' },
  { id: 'gyronny', w: 3, kind: 'party', name: 'Gyronny', b: '<path d="M50 60L50 -20L130 -20ZM50 60L130 60L130 140ZM50 60L50 140L-30 140ZM50 60L-30 60L-30 -20Z"/>' },
  { id: 'chief', w: 9, kind: 'chief', name: 'a chief', b: '<rect x="-10" y="-10" width="120" height="44"/>' },
  { id: 'bar', w: 6, kind: 'ordinary', name: 'a fess', b: '<rect x="-10" y="45" width="120" height="30"/>' },
  { id: 'palebar', w: 5, kind: 'ordinary', name: 'a pale', b: '<rect x="35" y="-10" width="30" height="140"/>' },
  { id: 'bendbar', w: 5, kind: 'ordinary', name: 'a bend', b: rot(42, '<rect x="-40" y="46" width="180" height="28"/>') },
  { id: 'chevbar', w: 4, kind: 'ordinary', name: 'a chevron', b: '<path d="M-14 96L50 34L114 96V124L50 62L-14 124Z"/>' },
  { id: 'cross', w: 4, kind: 'ordinary', name: 'a cross', b: '<rect x="38" y="-10" width="24" height="140"/><rect x="-10" y="44" width="120" height="24"/>' },
  { id: 'saltirebar', w: 3, kind: 'ordinary', name: 'a saltire', b: rot(40, '<rect x="-40" y="47" width="180" height="26"/>') + rot(-40, '<rect x="-40" y="47" width="180" height="26"/>') },
  { id: 'bordure', w: 7, kind: 'bordure', name: 'a bordure', b: '' },
  { id: 'barry', w: 3, kind: 'party', name: 'Barry of six', b: '<rect x="-10" y="20" width="120" height="20"/><rect x="-10" y="60" width="120" height="20"/><rect x="-10" y="100" width="120" height="30"/>' },
  { id: 'paly', w: 2, kind: 'party', name: 'Paly of six', b: '<rect x="16.7" y="-10" width="16.7" height="140"/><rect x="50" y="-10" width="16.7" height="140"/><rect x="83.3" y="-10" width="30" height="140"/>' },
];
const WAVY_BASE: Division = { id: 'basewavy', w: 0, kind: 'base', name: 'a base wavy', b: '<path d="M-10 92Q2.5 84 15 92T40 92T65 92T90 92T115 92V130H-10Z"/>' };
const DIV_TOTAL = DIVISIONS.reduce((t, d) => t + d.w, 0);
function divisionOf(id: string): Division {
  let x = hash(`div:${id}`) % DIV_TOTAL;
  for (const d of DIVISIONS) { if (x < d.w) return d; x -= d.w; }
  return DIVISIONS[0];
}

// ---------------------------------------------------------------- what the arms show
const shipFor = (era: number) => (era <= 2 ? 'galley' : era <= 4 ? 'caravel' : 'steamer');
const FAITH: Record<string, string> = { religion: 'star6', sect: 'star8', reform: 'star5', philosophy: 'wheel', pantheon: 'sun', cult: 'crescent', ideology: 'torch' };

/** The charge for what the record says this was. */
export function chargeOf(spec: ArmsSpec): string {
  const [id, , , form, era, flags] = spec;
  if (form.startsWith('faith:')) return FAITH[form.slice(6)] ?? 'star6';
  if (form === 'city' || form === 'port') return 'castle';
  if (flags & ARMS_REBEL) return 'sword';
  if (flags & ARMS_HORDE || form === 'horde') return 'horse';
  if (flags & ARMS_COLONY || form === 'colony') return 'anchor';
  if (form === 'theocracy') return 'star6';
  if (form === 'city-state') return 'tower';
  if (form === 'merchant-republic') return flags & ARMS_NAVAL ? shipFor(era) : 'key';
  if (flags & ARMS_NAVAL) return shipFor(era);
  if (flags & ARMS_INDUSTRIAL && ['republic', 'democracy', 'federation', 'one-party-state', 'constitutional-monarchy'].includes(form)) return 'gear';
  if (form === 'chiefdom') return 'tree';
  // the royal and imperial emblems vary by house of arms (the id), so neighbouring empires are not all alike
  if (form === 'feudal-kingdom') return hash(`king:${id}`) % 3 ? 'fleur' : 'lion';
  if (form === 'empire') return (['imperial', 'eagle', 'orb', 'lion'] as const)[hash(`emp:${id}`) % 4];
  if (form === 'republic' || form === 'democracy') return 'column';
  if (form === 'federation') return 'stars';
  if (form === 'one-party-state') return 'torch';
  return hash(`king:${id}`) % 3 ? 'crown' : 'lion';
}

interface Layout { shield: Shield; div: Division; a: Tincture; b: Tincture; charge: string }
function layout(spec: ArmsSpec): Layout {
  const [id, culture, religion, form, era] = spec;
  const colour = colourOf(culture), metal = metalOf(religion, id);
  const faith = form.startsWith('faith:');
  const shield = faith ? VESICA : SHIELDS[Math.max(0, Math.min(SHIELDS.length - 1, era))];
  const div = form === 'port' ? WAVY_BASE : faith && ['gyronny', 'barry', 'paly', 'saltire'].includes(divisionOf(id).id) ? DIVISIONS[0] : divisionOf(id);
  // the field is a colour (charges in metal) unless the hash says metal first; either way the two never meet like with like
  const metalFirst = div.kind !== 'plain' && hash(`first:${id}`) % 2 === 1;
  return { shield, div, a: metalFirst ? metal : colour, b: metalFirst ? colour : metal, charge: chargeOf(spec) };
}

/** A herald's description of the arms: "Per bend Or and Gules, a crown counterchanged". */
export function blazon(spec: ArmsSpec): string {
  const L = layout(spec);
  const ch = CHARGES[L.charge].name;
  switch (L.div.kind) {
    case 'plain': return `${L.a.name}, ${ch} ${L.b.name}`;
    case 'party': return `${L.div.name} ${L.a.name} and ${L.b.name}, ${ch} counterchanged`;
    case 'ordinary': return `${L.a.name}, ${L.div.name} ${L.b.name}, over all ${ch} counterchanged`;
    default: return `${L.a.name}, ${ch} and ${L.div.name} ${L.b.name}`;
  }
}

const idSafe = (s: string) => s.replace(/[^a-z0-9]/gi, '');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function chargeMarkup(c: Charge, fill: string, transform: string, outline = false): string {
  const parts = c.parts.map((p) => `<path d="${p.d}"${p.t ? ` transform="${p.t}"` : ''} fill-rule="evenodd"/>`).join('');
  return outline
    ? `<g transform="${transform}" fill="none" stroke="${LINE}" stroke-width="2.4" stroke-linejoin="round" opacity=".85">${parts}</g>`
    : `<g transform="${transform}" fill="${fill}">${parts}</g>`;
}

/** Shading laid over a field: light from the upper left, like enamel or painted wood. */
function sheen(u: string, d: string): [string, string] {
  return [
    `<linearGradient id="g${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".32"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>`,
    `<path d="${d}" fill="url(#g${u})"/>`,
  ];
}

/** The coat of arms as an SVG string (viewBox 0 0 100 120). `uid` keeps clip-path ids unique when one page shows the
 *  same arms twice; it defaults to the id. */
export function armsSvg(spec: ArmsSpec, opts: { uid?: string; title?: boolean; cls?: string } = {}): string {
  const L = layout(spec);
  const u = idSafe(opts.uid ?? `a${spec[0]}`);
  const { shield: S, div: D } = L;
  let cx = S.cx, cy = S.cy, size = S.size;
  if (D.kind === 'chief') { cy += 13; size *= 0.8; }
  if (D.kind === 'bordure') size *= 0.74;
  if (D.kind === 'base') { cy -= 9; size *= 0.8; }
  const c = CHARGES[L.charge];
  const tf = `translate(${f(cx - size / 2)} ${f(cy - size / 2)}) scale(${f(size / 100)})`;
  const [grad, shade] = sheen(u, S.d);
  const inset = 'translate(50 58) scale(.8) translate(-50 -58)';
  const field = D.kind === 'bordure'
    ? `<rect x="-10" y="-10" width="120" height="140" fill="${L.b.fill}"/><path d="${S.d}" transform="${inset}" fill="${L.a.fill}" stroke="${LINE}" stroke-opacity=".35" stroke-width="1"/>`
    : `<rect x="-10" y="-10" width="120" height="140" fill="${L.a.fill}"/>${D.b ? `<g fill="${L.b.fill}" stroke="${LINE}" stroke-opacity=".3" stroke-width=".8">${D.b}</g>` : ''}`;
  const charge = chargeMarkup(c, L.b.fill, tf) + (D.b && D.kind !== 'bordure' ? `<g clip-path="url(#b${u})">${chargeMarkup(c, L.a.fill, tf)}</g>` : '') + chargeMarkup(c, '', tf, true);
  const title = opts.title !== false ? `<title>${esc(blazon(spec))}</title>` : '';
  return `<svg class="${opts.cls ?? 'arms'}" viewBox="0 0 100 120" ${title ? 'role="img"' : 'aria-hidden="true"'} xmlns="http://www.w3.org/2000/svg">${title}<defs><clipPath id="s${u}"><path d="${S.d}"/></clipPath>${D.b ? `<clipPath id="b${u}">${D.b}</clipPath>` : ''}${grad}</defs><g clip-path="url(#s${u})">${field}${charge}${shade}</g><path d="${S.d}" fill="none" stroke="${LINE}" stroke-width="2.6"/></svg>`;
}

// ---------------------------------------------------------------- personal seals
/** The highest role a person held decides their charge; the order runs from the throne down. */
const ROLE_ORDER = ['ruler', 'president', 'chairman', 'usurper', 'regent', 'prophet', 'founder', 'general', 'inventor', 'philosopher', 'rebel', 'explorer', 'merchant', 'envoy', 'priest', 'historian', 'scribe', 'translator', 'archaeologist', 'governor', 'consort', 'heir'];

/** The role a seal is drawn for: the highest the person ever held. */
export function sealRole(spec: SigilSpec): string {
  const roles = spec[2].split(',').filter(Boolean);
  return ROLE_ORDER.find((r) => roles.includes(r)) ?? roles[0] ?? 'person';
}

function sealCharge(spec: SigilSpec): string {
  const role = sealRole(spec);
  const era = spec[4], naval = (spec[8] & ARMS_NAVAL) !== 0;
  switch (role) {
    case 'ruler': return 'crown';
    case 'president': return 'column';
    case 'chairman': return 'torch';
    case 'usurper': return 'sword';
    case 'regent': case 'governor': return 'key';
    case 'prophet': case 'founder': return 'star6';
    case 'general': return 'swords';
    case 'inventor': return era <= 2 ? 'wheel' : era <= 4 ? 'press' : 'gear';
    case 'philosopher': case 'archaeologist': return 'book';
    case 'rebel': return 'chain';
    case 'explorer': return shipFor(era);
    case 'merchant': return naval ? shipFor(era) : 'scales';
    case 'envoy': return 'dove';
    case 'priest': return 'chalice';
    case 'historian': case 'scribe': case 'translator': return 'scroll';
    case 'consort': return 'rose';
    case 'heir': return 'label';
    default: return 'star5';
  }
}

/** Letters of the age: incised capitals early, a scribe's italic in the age of parchment, print, then a modern sans. */
function letterStyle(era: number): { family: string; weight: number; style: string; size: number } {
  if (era <= 1) return { family: `'EB Garamond Variable','EB Garamond',Georgia,serif`, weight: 500, style: 'normal', size: 25 };
  if (era <= 3) return { family: `'EB Garamond Variable','EB Garamond',Georgia,serif`, weight: 600, style: 'italic', size: 27 };
  if (era <= 4) return { family: `'EB Garamond Variable','EB Garamond',Georgia,serif`, weight: 700, style: 'normal', size: 25 };
  return { family: `'Inter Variable',Inter,system-ui,sans-serif`, weight: 700, style: 'normal', size: 21 };
}

function initialOf(name: string): string {
  const m = name.normalize('NFC').match(/\p{L}/u);
  return m ? m[0].toLocaleUpperCase('en-US') : '';
}

/** A herald's description of the seal. */
export function sigilBlazon(spec: SigilSpec): string {
  const [, sex, , name, , dynasty, culture, religion] = spec;
  const colour = colourOf(culture), metal = metalOf(religion, spec[0]);
  const ch = CHARGES[sealCharge(spec)].name;
  const shape = sex === 'f' ? 'A lozenge' : 'A seal';
  const field = dynasty >= 0 ? `quarterly ${hash(`dyn:${dynasty}`) % 2 ? `${metal.name} and ${colour.name}` : `${colour.name} and ${metal.name}`}, ${ch} counterchanged` : `${colour.name}, ${ch} ${metal.name}, within a bordure ${metal.name}`;
  const ini = initialOf(name);
  return `${shape}, ${field}${ini ? `, the letter ${ini}` : ''}`;
}

/** A person's seal as an SVG string (viewBox 0 0 100 100): round for men, a lozenge for women. */
export function sigilSvg(spec: SigilSpec, opts: { uid?: string; title?: boolean; cls?: string } = {}): string {
  const [id, sex, , name, era, dynasty, culture, religion] = spec;
  const u = idSafe(opts.uid ?? `s${id}`);
  const colour = colourOf(culture), metal = metalOf(religion, id);
  const quarterly = dynasty >= 0;
  const swap = quarterly && hash(`dyn:${dynasty}`) % 2 === 1;
  const A = swap ? metal : colour, B = swap ? colour : metal;
  const lozenge = sex === 'f';
  const outer = lozenge ? 'M50 1L99 50L50 99L1 50Z' : circle(50, 50, 49);
  const inner = lozenge ? 'M50 12L88 50L50 88L12 50Z' : circle(50, 50, 40);
  const c = CHARGES[sealCharge(spec)];
  const ini = initialOf(name);
  const size = ini ? (lozenge ? 36 : 45) : (lozenge ? 44 : 54);
  const cy = ini ? (lozenge ? 41 : 41) : 50;
  const tf = `translate(${f(50 - size / 2)} ${f(cy - size / 2)}) scale(${f(size / 100)})`;
  const quarters = '<rect x="50" y="0" width="50" height="50"/><rect x="0" y="50" width="50" height="50"/>';
  const ls = letterStyle(era);
  const letter = (fill: string) => ini ? `<text x="50" y="${lozenge ? 77 : 80}" text-anchor="middle" font-family="${ls.family}" font-weight="${ls.weight}" font-style="${ls.style}" font-size="${lozenge ? ls.size - 5 : ls.size}" fill="${fill}" stroke="${LINE}" stroke-width=".7" stroke-opacity=".55" paint-order="stroke">${esc(ini)}</text>` : '';
  // beads around the rim, like the border of a wax seal
  const beads = Array.from({ length: lozenge ? 0 : 28 }, (_, i) => { const a = (i / 28) * 2 * Math.PI; return circle(50 + 44.5 * Math.cos(a), 50 + 44.5 * Math.sin(a), 1.25); }).join('');
  const [grad, shade] = sheen(u, outer);
  const body = quarterly
    ? `<rect width="100" height="100" fill="${A.fill}"/><g fill="${B.fill}">${quarters}</g>${chargeMarkup(c, B.fill, tf)}<g clip-path="url(#q${u})">${chargeMarkup(c, A.fill, tf)}</g>${chargeMarkup(c, '', tf, true)}${letter(B.fill)}<g clip-path="url(#q${u})">${letter(A.fill)}</g>`
    : `<rect width="100" height="100" fill="${colour.fill}"/>${chargeMarkup(c, metal.fill, tf)}${chargeMarkup(c, '', tf, true)}${letter(metal.fill)}`;
  const title = opts.title !== false ? `<title>${esc(sigilBlazon(spec))}</title>` : '';
  return `<svg class="${opts.cls ?? 'sigil'}" viewBox="0 0 100 100" ${title ? 'role="img"' : 'aria-hidden="true"'} xmlns="http://www.w3.org/2000/svg">${title}<defs><clipPath id="i${u}"><path d="${inner}"/></clipPath><clipPath id="q${u}">${quarters}</clipPath>${grad}</defs>`
    + `<path d="${outer}" fill="${metal.fill}"/><path d="${beads}" fill="${colour.fill}" opacity=".75"/>`
    + `<g clip-path="url(#i${u})">${body}</g><path d="${inner}" fill="none" stroke="${LINE}" stroke-width="1.6"/>${shade}<path d="${outer}" fill="none" stroke="${LINE}" stroke-width="2.2"/></svg>`;
}

/** Everything a page needs for a person's seal. */
export function sigilFor(spec: SigilSpec, uid?: string): { svg: string; blazon: string; role: string } {
  return { svg: sigilSvg(spec, { uid }), blazon: sigilBlazon(spec), role: sealRole(spec) };
}

/** Everything a page needs for a coat of arms. */
export function armsFor(spec: ArmsSpec, uid?: string): { svg: string; blazon: string } {
  return { svg: armsSvg(spec, { uid }), blazon: blazon(spec) };
}

/** Every charge, for a sampler. */
export const CHARGE_NAMES = Object.keys(CHARGES);
