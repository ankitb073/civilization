// The Tablet House: scene art generator (docs/art/ART.md).
// Renders every era × beat backdrop and the three title plates on a local ComfyUI with Wan 2.2 T2V A14B as a still-image
// model (one frame), then encodes them into atlas/public/game/art (<id>.webp, <id>-m.webp) and writes art.json.
//
//   node scripts/art/tablet-art.ts gen [--only=bronze-muster,title,walls] [--seeds=2] [--from=0] [--force]
//   node scripts/art/tablet-art.ts process [--partial]
//   node scripts/art/tablet-art.ts prompts
//
// `gen` writes raw PNGs to build/art/raw/<id>-s<seed>.png (seed = the id's base seed + n for n in from..from+seeds-1).
// `process` takes the seed chosen in PICKS (the base seed when absent) for each id.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const COMFY = process.env.COMFY_URL ?? 'http://127.0.0.1:8188';
const COMFY_OUT = process.env.COMFY_OUT ?? '/Users/btank/projects/comfyui/output';
const ROOT = new URL('../../', import.meta.url).pathname;
const RAW = join(ROOT, 'build/art/raw');
const OUT = join(ROOT, 'atlas/public/game/art');

export const MODEL = 'Wan 2.2 T2V A14B (high + low noise experts, fp16; Comfy-Org/Wan_2.2_ComfyUI_Repackaged), Apache-2.0';
// Two-expert Wan 2.2 sampling: the high-noise expert lays out the first half of the steps, the low-noise expert refines.
// 1280×720 is the model's native training size (it holds composition best there); the result is Lanczos-scaled ×1.2.
const SAMPLING = { width: 1280, height: 720, steps: 20, switchAt: 10, cfg: 3.5, sampler: 'euler', scheduler: 'simple', shift: 8 };
const FULL_W = 1536, FULL_H = 864, MOBILE_W = 768, MOBILE_H = 432;
// Wan sometimes paints a 1–3 px canvas edge; every render is trimmed to this 16:9 window before scaling.
const TRIM = { x: 6, y: 4, w: 1268, h: 713 };
/** A tighter 16:9 window for a render whose painting stops short of the edge (an unpainted canvas margin), by render. */
const CROP: Record<string, { x: number; y: number; w: number; h: number }> = {
  'title-hands-s7711': { x: 72, y: 46, w: 1136, h: 639 },
};
const MAX_BYTES = 220 * 1024;

/** The locked style: every prompt is STYLE_HEAD + scene + STYLE_TAIL. */
export const STYLE_HEAD = 'A loose painterly oil sketch with thick, visible brushstrokes, broad soft edges and atmospheric light.';
export const STYLE_TAIL = 'Muted, restrained colours with earthy umber and ochre tones and small touches of rust red; aerial perspective; quiet, solemn mood.';
/** The locked negative prompt (effective: Wan samples at CFG 3.5). Each era adds its anachronisms (EraKit.not). */
export const NEGATIVE = 'text, letters, words, writing, inscription, signature, watermark, caption, signboard, frame, border, photograph, photorealistic, 3d render, CGI, modern objects, cars, electric lights, electric pylons, close-up faces, portrait, gore, blood, deformed figures, extra limbs, crosses, crescents, religious symbols, national flags, emblems, onion domes, pyramids, ziggurats, pagodas, cathedral, oversaturated, cartoon, anime, blurry';

type Era = 'bronze' | 'iron' | 'medieval' | 'earlymodern' | 'industrial';
type Beat = 'muster' | 'field' | 'walls' | 'sack' | 'treaty' | 'tablet';

interface EraKit {
  city: string;        // the city, seen from outside
  short: string;       // the city in a few words
  levy: string;        // the troops marching out
  battle: string;      // what a distant battle of the age looks like
  camp: string;        // the besiegers' camp
  envoys: string;      // the envoys and their escort
  room: string;        // the scribe's room
  desk: string;        // what is on the scribe's table
  view: string;        // what the window shows
  not: string;         // anachronisms for this age, added to the negative prompt
}

const ERAS: Record<Era, EraKit> = {
  bronze: {
    city: 'a city built of sun-dried mud brick on a wide, flat river plain: flat-roofed, box-shaped houses the colour of dust, thick sloping walls with square towers and a great gate of dark timber beams',
    short: 'a mud-brick city of flat roofs and square towers',
    levy: 'spearmen with bronze-tipped spears and tall wicker shields, a few two-wheeled war chariots drawn by pairs of horses at the head of the column',
    battle: 'two-wheeled war chariots and dense blocks of spearmen',
    camp: 'low rectangular tents of hide',
    envoys: 'a few envoys in long wool robes beside tall plain cloth standards on poles, a war chariot and spearmen with bronze spears waiting behind them',
    room: 'a small room with plastered mud-brick walls and a low wooden table',
    desk: 'several small pillow-shaped tablets of soft grey-brown clay, a lump of damp clay, a reed stylus and a small open clay oil lamp with a flame',
    view: 'flat mud-brick rooftops of the city under a deep blue night sky',
    not: 'tile roofs, iron, armour plates, crossbows, gunpowder smoke, cannons, guns, chimneys, paper, books',
  },
  iron: {
    city: 'a walled hill city of stone houses with flat timber roofs, massive walls of dressed grey stone with round towers and an arched stone gate',
    short: 'a stone-walled hill city with round towers',
    levy: 'infantry in iron helmets carrying long spears and plain round shields, with a squadron of horsemen riding at its head',
    battle: 'lines of spear infantry and wheeling squadrons of cavalry',
    camp: 'low rectangular leather tents and horse lines',
    envoys: 'a few envoys in long cloaks under tall plain banners of undyed cloth, an escort of horsemen with iron spears waiting behind them',
    room: 'a small room with rough stone walls and a plain wooden table',
    desk: 'rolls of papyrus, one partly unrolled and blank, a reed pen, a small pot of black ink and a clay oil lamp with a flame',
    view: 'stone rooftops and a round tower of the city wall under a deep blue night sky',
    not: 'crossbows, plate armour, gunpowder smoke, cannons, guns, chimneys, books, candles',
  },
  medieval: {
    city: 'a walled town of steep terracotta tile roofs and tall square stone towers, curtain walls with battlements and a fortified gatehouse',
    short: 'a walled town of tile roofs and square stone towers',
    levy: 'crossbowmen and spearmen in padded coats and iron kettle helmets, with mounted knights in mail carrying plain pennants',
    battle: 'blocks of crossbowmen and spearmen and a charge of mounted knights',
    camp: 'canvas pavilions, wooden siege towers and trebuchets',
    envoys: 'a few envoys on horseback in long dark cloaks under tall plain banners of rust-red cloth, an escort of crossbowmen waiting behind them',
    room: 'a stone chamber with a small arched window and a heavy oak writing desk',
    desk: 'a stack of blank parchment sheets, a goose-feather quill, a horn inkwell, a closed leather-bound book and a beeswax candle in an iron holder',
    view: 'steep tile roofs and stone towers of the town under a deep blue night sky',
    not: 'gunpowder smoke, cannons, guns, muskets, factory chimneys, printed paper, church, cathedral',
  },
  earlymodern: {
    city: 'a fortified city behind low, angled, star-shaped bastions of brick and earth with a wide moat, tall gabled houses with tile roofs inside the walls',
    short: 'a city behind low angled brick bastions',
    levy: 'musketeers in long wool coats and broad-brimmed hats and pikemen with very long pikes, a few bronze cannon on wooden carriages drawn by horses',
    battle: 'squares of pikemen and lines of musketeers wrapped in drifting white gunpowder smoke, cannon fire flashing in the haze',
    camp: 'siege trenches, earthwork gun batteries and low canvas tents, white gunpowder smoke drifting',
    envoys: 'a few envoys in dark coats and broad hats under tall plain banners of undyed cloth, a coach and an escort of musketeers waiting behind them',
    room: 'a timber-beamed room with whitewashed walls, a small window of leaded panes and a writing desk',
    desk: 'stacks of paper, loose printed sheets lying face down, a quill pen, a pewter inkwell, a stick of red sealing wax and a brass oil lamp with a flame',
    view: 'gabled tile roofs of the city under a deep blue night sky',
    not: 'factory chimneys, railways, trains, rifles, telegraph poles, top hats, church, cathedral',
  },
  industrial: {
    city: 'an industrial city of brick terraces and slate roofs, tall brick factory chimneys trailing smoke, an iron railway bridge, wooden telegraph poles with sagging wires along the road',
    short: 'a brick city of tall factory chimneys',
    levy: 'riflemen in plain grey-brown greatcoats and peaked caps with rifles on their shoulders, field guns drawn by horses, a steam locomotive on the railway line beside the road',
    battle: 'lines of riflemen and puffs of white rifle smoke, artillery shell bursts, a railway embankment crossing the plain',
    camp: 'rows of low canvas tents, field guns and a steam locomotive on a railway siding',
    envoys: 'a few envoys in dark frock coats under tall plain white banners, a horse-drawn carriage and a file of riflemen in greatcoats waiting behind them, wooden telegraph poles and wires overhead',
    room: 'a plain office with wood-panelled walls, a heavy wooden desk and a tall sash window',
    desk: 'closed paper ledgers, loose blank sheets, a wooden dip pen with a steel nib, a glass inkwell and a brass kerosene lamp with a glass chimney',
    view: 'brick rooftops and smoking factory chimneys of the city under a dark smoky night sky',
    not: 'cars, trucks, tanks, aeroplanes, electric street lights, typewriter, telephone',
  },
};

const BEAT_SEED: Record<Beat, number> = { muster: 1101, field: 2202, walls: 3303, sack: 4404, treaty: 5505, tablet: 6606 };

const BEATS: Record<Beat, (k: EraKit) => string> = {
  muster: (k) => `Early morning. A high, distant view from the top of the city wall, looking down and outward: far below, the levy marches out of the great gate in a long thin column of tiny figures and away along a dusty road across the plain toward low hills: ${k.levy}. ${cap(k.city)}. Pale golden morning light, low mist over the fields, long soft shadows; warm parchment and ochre tones; every figure tiny and seen from behind.`,
  field: (k) => `A hazy afternoon. From the top of the city wall, with the worn stone parapet across the foreground and two or three small onlookers seen from behind, a battle is fought far away across the plain: ${k.battle}, tiny in the distance and half hidden in great rolling clouds of ochre dust. Wide pale sky; dusty ochre and grey-green tones.`,
  walls: (k) => `Dusk under siege. ${cap(k.city)}, seen from a low hill outside at twilight, a few torches on its walls. All around it on the darkening plain the besiegers' campfires form a wide ring of small orange points of light among ${k.camp}, thin smoke rising. Deep slate-blue and umber dusk with a last band of ochre light on the horizon.`,
  sack: (k) => `Night. Seen from far across the dark plain, ${k.short} burns: its roofs engulfed in fire, towering columns of smoke lit orange from below, sparks and embers drifting into the black sky, the walls black against the glow; tiny dark silhouettes stream out of the gate. Black, umber and fiery orange.`,
  treaty: (k) => `A cold grey dawn. Before the closed gate of ${k.short}, ${k.envoys}; a few officials of the city come out to meet them on the muddy road. Mist, wet ground, pale overcast light; cold grey and pale ochre tones; every figure small in the frame and seen from a distance.`,
  tablet: (k) => `Interior at night, a still life with no people. A scribe's workroom: ${k.room}. On the table lie ${k.desk}, lit by the warm glow of the flame. Through the window beyond the table, ${k.view}. Warm umber and sepia lamplight against the blue night.`,
};

const TITLES: Record<string, { seed: number; scene: string; not: string; alt: string }> = {
  hands: {
    seed: 7707,
    scene: 'Close view from above of a scribe\'s two hands in plain wool sleeves, pressing the wedge-shaped tip of a reed stylus into a soft, smooth tablet of damp grey-brown clay on a worn wooden table; a small clay oil lamp with a flame glowing beside it; warm umber darkness all around.',
    not: 'pen, pencil, paper, book, rings, jewellery, face',
    alt: 'A scribe\'s hands pressing a reed stylus into a soft clay tablet by lamplight.',
  },
  city: {
    seed: 7808,
    scene: 'A walled city on a hill at dusk, seen from far across a quiet valley: flat roofs and square towers crowded inside its walls, small warm lights in windows, thin smoke rising from hearths, a road winding up to the gate; a long ochre afterglow fading into a slate-blue sky.',
    not: 'church, cathedral, chimneys, electric lights',
    alt: 'A walled city on a hill at dusk, seen from across a valley, lamps lit in its windows.',
  },
  ash: {
    seed: 7909,
    scene: 'Still life, close view: a broken tablet of baked clay lying in grey ash and charred timber, split into three jagged pieces, its surface rough and worn, a thin wisp of smoke rising, cold pale dawn light from one side; grey, charcoal and umber tones.',
    not: 'paper, book, stone carving',
    alt: 'A broken clay tablet lying in grey ash and charred timber.',
  },
};

const ALT: Record<Beat, (era: Era) => string> = {
  muster: (e) => `Morning: the levy of ${ERA_NAME[e]} city marches out of the gate onto the plain, seen from the wall.`,
  field: (e) => `A distant battle under clouds of dust, seen from the walls of ${ERA_NAME[e]} city.`,
  walls: (e) => `Dusk: the besiegers' campfires ring ${ERA_NAME[e]} city.`,
  sack: (e) => `Night: ${ERA_NAME[e]} city burning.`,
  treaty: (e) => `Grey dawn: envoys under plain banners at the gate of ${ERA_NAME[e]} city.`,
  tablet: (e) => `The scribe's room by lamplight: ${DESK_NAME[e]} on the table, the city through the window.`,
};
const ERA_NAME: Record<Era, string> = {
  bronze: 'a mud-brick Bronze Age', iron: 'a stone-walled Iron Age', medieval: 'a medieval', earlymodern: 'a bastioned early-modern', industrial: 'an industrial',
};
const DESK_NAME: Record<Era, string> = {
  bronze: 'clay tablets and a reed stylus', iron: 'papyrus rolls and a reed pen', medieval: 'parchment and a quill',
  earlymodern: 'paper and printed sheets', industrial: 'paper ledgers and a dip pen',
};

/** Seed chosen per id after review (base seed + n). Absent ids use the base seed. */
const PICKS: Record<string, number> = {
  'industrial-treaty': 5506,   // s5505: figures too large and close; s5507: weaker composition
  'iron-treaty': 5507,         // s5505: a modern-looking suit; s5506: large foreground figures with faces
  'medieval-treaty': 5507,     // s5505: modern suits and ties; s5506: larger foreground riders
  'earlymodern-tablet': 6608,  // s6606 and s6607: handwriting-like scribbles on the sheets
  'earlymodern-treaty': 5507,  // s5505 and s5506: crowds of mid-sized figures with faces
  'bronze-tablet': 6608,       // see SCENE
  'title-hands': 7711,         // see SCENE; cropped (CROP)
  'title-ash': 7911,           // see SCENE
};
/** Per-id scene amendments made after review (appended to the scene). */
const AMEND: Record<string, string> = {
  // first render: an official in what reads as a modern suit, large foreground figures
  'iron-treaty': 'The officials wear long plain wool robes; the whole party is seen from far off, small on the road.',
  // (tried for earlymodern-muster: 'The gate is cut through a low, thick, angled earthwork bastion faced with brick…';
  //  s1102 still painted crenellated walls, with larger figures, so the first render s1101 was kept and the amendment dropped)
  // first renders: three officials in modern suits and ties; handwriting-like scribbles on the sheets and a metal-nib pen
  'medieval-treaty': 'The city\'s officials wear long hooded wool robes and cloaks; the whole party is seen from far off, small on the road.',
  'earlymodern-tablet': 'Every sheet of paper is blank and clean; the pen is a long white goose quill.',
  // first render: a crowd of mid-sized figures with faces in the foreground
  'earlymodern-treaty': 'The whole party is seen from far off across the open ground, every figure small, most of them seen from behind.',
};
/** Per-id scenes that replace the beat's template after review, for renders the template got wrong. */
const SCENE: Record<string, string> = {
  // title-hands: s7707–09 painted a slate tray and white margins; this chiaroscuro wording gave s7711 (picked, cropped
  // inside its margin). title-ash: s7909 a cartoon tray, s7910 brick-like blocks, s7912/13 (a chiaroscuro wording)
  // cheese-like blocks; this wording's s7911 (a cracked fired-clay slab) was picked.
  'title-hands': 'Chiaroscuro. In warm lamplight against deep darkness, a scribe\'s two hands in rough linen sleeves hold a thin reed stylus and press its wedge-shaped end into a small, thick, pillow-shaped tablet of damp grey-brown clay, no bigger than a palm, resting on a rough wooden table; a small clay saucer lamp with a single flame beside it. The painting fills the whole canvas from edge to edge.',
  'title-ash': 'Still life, close view: a thick, heavy tablet of fired clay, the size of a palm, broken across into three rough pieces with crumbling edges, lying half-buried in soft grey ash among charred black timbers and embers gone cold; a thin wisp of grey smoke; cold pale dawn light from one side; grey, charcoal and umber tones.',
  // first render s6606: a glazed sash window, pitched roofs, a metal lantern and pebble-like tablets. This scene gave s6607
  // (unpainted canvas border, rejected) and s6608 (picked). A third wording ('pillow-shaped … no bigger than a palm',
  // s6609/s6610) gave soap-bar and pebble shapes and was dropped.
  'bronze-tablet': 'Interior at night, a still life with no people. A scribe\'s workroom in a mud-brick house: thick walls of plastered mud brick, and in the wall a small square opening without glass, showing flat mud-brick rooftops under a deep blue night sky. On a low wooden table lie several small flat clay tablets, rectangular with rounded corners, each the size of a palm, their surfaces smooth and blank; a lump of damp grey clay; a thin reed stylus; and a small open clay saucer lamp, a shallow dish of oil with a single floating wick and a small flame. Warm umber and sepia lamplight against the blue night.',
};
/** Per-id additions to the negative prompt after review. */
const NEG_AMEND: Record<string, string> = {
  'iron-treaty': 'suits, neckties, top hats, large figures in the foreground',
  'medieval-treaty': 'suits, neckties, shirts, large figures in the foreground',
  'earlymodern-tablet': 'handwriting, writing on paper, scribbles, lines of text, fountain pen, metal pen',
  'earlymodern-treaty': 'large figures in the foreground, faces, crowd close to the viewer',
  'title-hands': 'tray, slate, rim, knitted sweater, paintbrush, pen, white border, unpainted canvas edges, vignette, flat illustration',
  'title-ash': 'tray, plate, rim, chocolate, cartoon smoke, bright orange',
  'bronze-tablet': 'glass, window panes, window frame, lantern, metal lamp, candle, pebbles, stones, eggs, pitched roofs',
};
/** Retouches after review, keyed by render (id-sSEED), in render pixels (1280×720): a painter's signature that Wan sometimes paints into a bottom
 *  corner despite the negative prompt is covered by a clone of the canvas beside it: [x, y, w, h, source dx, source dy]. */
const RETOUCH: Record<string, [number, number, number, number, number, number][]> = {
  'iron-field-s2202': [[1170, 676, 110, 44, -116, 0]],
  'title-city-s7808': [[1104, 662, 108, 50, -120, 0]],
  'medieval-field-s2202': [[1170, 668, 106, 52, -112, 0]],
  'industrial-sack-s4404': [[8, 678, 104, 42, 110, 0]],
  'bronze-treaty-s5505': [[1132, 682, 144, 38, -150, 0]],
  'industrial-muster-s1101': [[172, 678, 94, 28, 70, -45]],
  'bronze-field-s2202': [[1170, 668, 106, 52, -112, 0]],
  'medieval-sack-s4404': [[4, 682, 100, 38, 110, 0]],
  'industrial-tablet-s6606': [[1194, 680, 84, 32, -90, 0]],
  'earlymodern-sack-s4404': [[8, 688, 104, 32, 112, 0]],
  'industrial-treaty-s5506': [[1178, 646, 96, 42, 0, -44]],
  'bronze-tablet-s6608': [[1150, 660, 100, 60, -104, 0]],
  'iron-treaty-s5507': [[4, 686, 84, 34, 0, -40]],
  'medieval-treaty-s5507': [[4, 684, 84, 36, 0, -40]],
  'earlymodern-tablet-s6608': [[1156, 654, 120, 66, 0, -66]],
  'earlymodern-treaty-s5507': [[4, 684, 92, 36, 0, -40]],
};

interface Job { id: string; era: string; beat: string; seed: number; prompt: string; negative: string; alt: string }
/** What produced a render, written beside it (build/art/raw/<id>-s<seed>.json) and copied into art.json. */
interface RenderMeta { prompt: string; negative: string; seed: number; model: string; sampling: typeof SAMPLING }

function cap(s: string): string { return s[0].toUpperCase() + s.slice(1); }

/** All jobs, ordered so the first six cover every beat in different eras (early review of each beat's prompt). */
function jobs(): Job[] {
  const eras = Object.keys(ERAS) as Era[], beats = Object.keys(BEATS) as Beat[];
  const out: Job[] = [];
  for (let r = 0; r < eras.length; r++) {
    beats.forEach((beat, b) => {
      const era = eras[(r + b) % eras.length], id = `${era}-${beat}`;
      const scene = (SCENE[id] ?? BEATS[beat](ERAS[era])) + (AMEND[id] ? ' ' + AMEND[id] : '');
      const negative = `${NEGATIVE}, ${ERAS[era].not}${NEG_AMEND[id] ? ', ' + NEG_AMEND[id] : ''}`;
      out.push({ id, era, beat, seed: BEAT_SEED[beat], prompt: `${STYLE_HEAD} ${scene} ${STYLE_TAIL}`, negative, alt: ALT[beat](era) });
    });
    if (r === 0) {
      for (const [beat, t] of Object.entries(TITLES)) {
        const id = `title-${beat}`;
        out.push({ id, era: 'title', beat, seed: t.seed, prompt: `${STYLE_HEAD} ${SCENE[id] ?? t.scene}${AMEND[id] ? ' ' + AMEND[id] : ''} ${STYLE_TAIL}`, negative: `${NEGATIVE}, ${t.not}${NEG_AMEND[id] ? ', ' + NEG_AMEND[id] : ''}`, alt: t.alt });
      }
    }
  }
  return out;
}

function workflow(j: Job, seed: number, prefix: string): Record<string, unknown> {
  const s = SAMPLING;
  const stage = (model: string, latent: unknown, first: boolean) => ({
    class_type: 'KSamplerAdvanced',
    inputs: {
      model: [model, 0], add_noise: first ? 'enable' : 'disable', noise_seed: seed, steps: s.steps, cfg: s.cfg, sampler_name: s.sampler, scheduler: s.scheduler,
      positive: ['7', 0], negative: ['8', 0], latent_image: latent, start_at_step: first ? 0 : s.switchAt, end_at_step: first ? s.switchAt : 10000,
      return_with_leftover_noise: first ? 'enable' : 'disable',
    },
  });
  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: 'wan2.2_t2v_high_noise_14B_fp16.safetensors', weight_dtype: 'default' } },
    2: { class_type: 'UNETLoader', inputs: { unet_name: 'wan2.2_t2v_low_noise_14B_fp16.safetensors', weight_dtype: 'default' } },
    3: { class_type: 'CLIPLoader', inputs: { clip_name: 'umt5_xxl_fp16.safetensors', type: 'wan', device: 'default' } },
    4: { class_type: 'VAELoader', inputs: { vae_name: 'wan_2.1_vae.safetensors' } },
    5: { class_type: 'ModelSamplingSD3', inputs: { model: ['1', 0], shift: s.shift } },
    6: { class_type: 'ModelSamplingSD3', inputs: { model: ['2', 0], shift: s.shift } },
    7: { class_type: 'CLIPTextEncode', inputs: { clip: ['3', 0], text: j.prompt } },
    8: { class_type: 'CLIPTextEncode', inputs: { clip: ['3', 0], text: j.negative } },
    9: { class_type: 'EmptyHunyuanLatentVideo', inputs: { width: s.width, height: s.height, length: 1, batch_size: 1 } },
    10: stage('5', ['9', 0], true),
    11: stage('6', ['10', 0], false),
    12: { class_type: 'VAEDecode', inputs: { samples: ['11', 0], vae: ['4', 0] } },
    13: { class_type: 'SaveImage', inputs: { images: ['12', 0], filename_prefix: prefix } },
  };
}

async function enqueue(wf: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${COMFY}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: wf, client_id: 'tablet-art' }) });
  if (!res.ok) throw new Error(`enqueue failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { prompt_id: string }).prompt_id;
}

async function waitFor(pid: string): Promise<string> {
  for (;;) {
    const h = (await (await fetch(`${COMFY}/history/${pid}`)).json()) as Record<string, { status: { status_str: string }; outputs: Record<string, { images?: { filename: string; subfolder: string }[] }> }>;
    const run = h[pid];
    if (run?.status?.status_str === 'error') throw new Error(`run ${pid} failed`);
    const img = run && Object.values(run.outputs).flatMap((o) => o.images ?? [])[0];
    if (img) return join(COMFY_OUT, img.subfolder, img.filename);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function gen(args: Map<string, string>): Promise<void> {
  mkdirSync(RAW, { recursive: true });
  const only = args.get('only')?.split(',');
  const seeds = Number(args.get('seeds') || 1), from = Number(args.get('from') || 0);
  const queued: { file: string; pid: string; meta: RenderMeta }[] = [];
  for (const j of jobs()) {
    if (only && !only.includes(j.id) && !only.includes(j.era) && !only.includes(j.beat)) continue;
    for (let n = from; n < from + seeds; n++) {
      const seed = j.seed + n, file = join(RAW, `${j.id}-s${seed}.png`);
      if (existsSync(file) && !args.has('force')) continue;
      queued.push({ file, pid: await enqueue(workflow(j, seed, `tablet/${j.id}-s${seed}`)), meta: { prompt: j.prompt, negative: j.negative, seed, model: MODEL, sampling: SAMPLING } });
    }
  }
  console.log(`queued ${queued.length}`);
  for (const q of queued) {
    copyFileSync(await waitFor(q.pid), q.file);
    writeFileSync(q.file.replace(/\.png$/, '.json'), JSON.stringify(q.meta, null, 1) + '\n');
    console.log(q.file);
  }
}

function webp(src: string, dst: string, w: number, h: number, q0: number, fixes: [number, number, number, number, number, number][] = [], win = TRIM): number {
  // Clone-patch any retouches, trim the edge, Lanczos-scale with ffmpeg, then encode; lower quality until it fits the budget.
  const png = dst.replace(/\.webp$/, '.tmp.png');
  let graph = '[0]null[c0]';
  fixes.forEach(([x, y, fw, fh, dx, dy], i) => {
    // feather the patch over 10 px, except along an edge that lies on the picture's border
    const f = 10, edges = [x > 0 ? 'X' : '', x + fw < SAMPLING.width ? '(W-1-X)' : '', y > 0 ? 'Y' : '', y + fh < SAMPLING.height ? '(H-1-Y)' : ''].filter(Boolean);
    const alpha = edges.reduce((m, e) => `min(${m},${e})`, '1e9');
    graph += `;[c${i}]split[a${i}][b${i}];[b${i}]crop=${fw}:${fh}:${x + dx}:${y + dy},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*clip(${alpha}/${f},0,1)'[p${i}];[a${i}][p${i}]overlay=${x}:${y}[c${i + 1}]`;
  });
  graph += `;[c${fixes.length}]format=rgb24,crop=${win.w}:${win.h}:${win.x}:${win.y},scale=${w}:${h}:flags=lanczos+accurate_rnd[out]`;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-filter_complex', graph, '-map', '[out]', png]);
  try {
    for (let q = q0; q >= 50; q -= 3) {
      execFileSync('cwebp', ['-quiet', '-q', String(q), '-m', '6', '-sharp_yuv', png, '-o', dst]);
      if (statSync(dst).size <= MAX_BYTES) return q;
    }
  } finally {
    execFileSync('rm', ['-f', png]);
  }
  throw new Error(`${dst} does not fit in ${MAX_BYTES} bytes`);
}

function processAll(partial: boolean): void {
  mkdirSync(OUT, { recursive: true });
  const manifest = [];
  const order = ['title', ...Object.keys(ERAS)], beatOrder = [...Object.keys(TITLES), ...Object.keys(BEATS)];
  const all = jobs().sort((a, b) => order.indexOf(a.era) - order.indexOf(b.era) || beatOrder.indexOf(a.beat) - beatOrder.indexOf(b.beat));
  for (const j of all) {
    const seed = PICKS[j.id] ?? j.seed;
    const src = join(RAW, `${j.id}-s${seed}.png`);
    if (!existsSync(src)) {
      if (partial) { console.log(`${j.id}  (no accepted render yet, skipped)`); continue; }
      throw new Error(`missing render ${src}`);
    }
    const meta = JSON.parse(readFileSync(src.replace(/\.png$/, '.json'), 'utf8')) as RenderMeta;
    const file = `${j.id}.webp`, mobile = `${j.id}-m.webp`;
    const key = `${j.id}-s${seed}`;
    const q = webp(src, join(OUT, file), FULL_W, FULL_H, 82, RETOUCH[key], CROP[key]);
    const qm = webp(src, join(OUT, mobile), MOBILE_W, MOBILE_H, 82, RETOUCH[key], CROP[key]);
    const kb = (f: string) => Math.round(statSync(join(OUT, f)).size / 1024);
    console.log(`${j.id}  s${seed}  ${kb(file)} KB (q${q})  ${kb(mobile)} KB (q${qm})`);
    // atlas/src/game/tablet/stage.tsx plays `video` (muted, looped, `file` as its poster) unless motion is reduced
    const video = existsSync(join(OUT, `${j.id}.webm`)) ? `${j.id}.webm` : undefined;
    manifest.push({ era: j.era, beat: j.beat, file, mobile, ...(video ? { video, poster: file } : {}), width: FULL_W, height: FULL_H, alt: j.alt, prompt: meta.prompt, negative: meta.negative, seed, model: meta.model, sampling: meta.sampling, ...(RETOUCH[key] ? { retouch: 'painted signature cloned out' } : {}), ...(CROP[key] ? { crop: 'cropped inside an unpainted canvas margin' } : {}) });
  }
  writeFileSync(join(OUT, 'art.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log(`wrote ${manifest.length} entries to ${join(OUT, 'art.json')}`);
}

const [cmd, ...rest] = process.argv.slice(2);
const args = new Map(rest.map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? ''] as [string, string]; }));
if (cmd === 'gen') await gen(args);
else if (cmd === 'process') processAll(args.has('partial'));
else if (cmd === 'prompts') for (const j of jobs()) console.log(`${j.id} (s${j.seed}): ${j.prompt}\n  NEG: ${j.negative}\n`);
else console.log('usage: node scripts/art/tablet-art.ts gen|process|prompts [--only=ids|eras|beats] [--seeds=n] [--from=n] [--force]');
