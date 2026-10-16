# The Tablet House: art

> **Note for the game UI and backdrop agents (status: DONE, 33 of 33 stills published; no video loops, see issue #50).**
> - **Where:** `atlas/public/game/art/` (served at `game/art/`), manifest `art.json`, an array of
>   `{era, beat, file, mobile, width, height, alt, prompt, negative, seed, model, sampling, retouch?, crop?}`.
> - **Scenes:** `<era>-<beat>.webp` 1536×864 and `<era>-<beat>-m.webp` 768×432 (use on phones), eras
>   `bronze iron medieval earlymodern industrial`, beats `muster field walls sack treaty tablet`: all 30 present.
>   There is no `held` art; `stage.tsx`'s fallback to `walls` covers it.
> - **Title plates:** `era: "title"`, beats `hands` (a scribe's hands pressing a stylus into clay), `city` (a city on a hill
>   at dusk), `ash` (a broken tablet in ash), files `title-<beat>.webp` / `-m.webp`. `artFor()` matches by era, so it never
>   returns these. They are for a title screen, loading screen, share card or the ending, if you want them.
> - **Sizes:** full 38–152 KB (median 82 KB, all 33 = 2.7 MB), mobile 8–33 KB (median 22 KB, 0.7 MB), all WebP q82.
> - **Look:** a loose painterly oil sketch with a muted umber, ochre, slate and rust palette. Muster scenes are golden
>   morning, walls are slate dusk with campfire rings, sacks are black and orange, treaties grey dawn, tablets warm
>   lamplight with a blue night window. Text and UI sit well on the darker lower third of the field, walls and sack plates;
>   a parchment veil over the top suits the bright muster and treaty plates.
> - **No `video` entries:** Wan 2.2 TI2V 5B renders noise on this Mac (issue #50 has the options). `stage.tsx` already
>   plays `video` + `poster` if a loop is ever added; `node scripts/art/tablet-art.ts process` lists any
>   `<era>-<beat>.webm` it finds.

## Model and licences

| Role | Model | Licence | Source |
|---|---|---|---|
| **Still images (used)** | Wan 2.2 T2V A14B, high- and low-noise experts, fp16, sampled as a one-frame video | Apache-2.0 | `Comfy-Org/Wan_2.2_ComfyUI_Repackaged` (repackaging of `Wan-AI/Wan2.2-T2V-A14B`) |
| Text encoder (used) | umT5-XXL fp16 | Apache-2.0 | same repository |
| VAE (used) | Wan 2.1 VAE | Apache-2.0 | same repository |
| Tested, rejected | Wan 2.2 TI2V 5B fp16 (+ Wan 2.2 VAE) | Apache-2.0 | same repository |
| Downloaded, tested, rejected | FLUX.1 [schnell] fp8 single-file checkpoint `flux1-schnell-fp8.safetensors` (17.2 GB, in `~/projects/comfyui/models/checkpoints/`, unused, safe to delete) | Apache-2.0 | `huggingface.co/Comfy-Org/flux1-schnell` |

Nothing with a non-commercial licence was downloaded or used. The Wan files were already installed in the local
ComfyUI (`~/projects/comfyui`); the only download was FLUX.1 [schnell].

### Why Wan 2.2 A14B, not the other two
- **Wan 2.2 TI2V 5B** (the brief's first choice) renders noise on this machine (ComfyUI 0.37, PyTorch 2.14 MPS, M5 Max).
  A single-frame still came out as a washed-out cyan blur at fp16 and at bf16 compute. A 17-frame image-to-video test
  turned every frame after the start image into blue noise at fp16 and at fp32. The Wan 2.2 VAE round-trips an image
  cleanly, so the fault is in the 5B model's sampling on MPS.
- **FLUX.1 [schnell]** (the brief's fallback, downloaded) is fast (about 40 s per 1792×1088 image) but not good enough
  for this brief:
  - In any painterly style it paints a painter's signature into a bottom corner of most images.
  - It adds shop signs and lettering.
  - It slips in anachronisms: a car in a Bronze Age town, an electricity pylon, ballpoint-like pens.
  - Its CFG-1 sampling ignores negative prompts, and at CFG 2 with a negative prompt it painted a giant signature
    across the picture.
  - Its paint reads as smooth digital concept art.
- **Wan 2.2 T2V A14B** reads as a real oil sketch (broken colour, canvas tooth, soft edges). It obeys a negative prompt
  at CFG 3.5 and keeps figures small when asked. It does paint a faint corner signature about half the time; those are
  cloned out (see Retouching). It takes about 3.4 minutes per image on the M5 Max.

## The locked style
Every prompt is `STYLE_HEAD + scene + STYLE_TAIL`. Every negative prompt is `NEGATIVE + the era's anachronisms`, plus a
per-image addition after review. All of it lives in `scripts/art/tablet-art.ts`. Each render's exact prompt, negative,
seed and sampling are written beside it and copied into `art.json`, and a check confirms that every pick's recorded
prompt equals what the script produces today.

- **STYLE_HEAD:** "A loose painterly oil sketch with thick, visible brushstrokes, broad soft edges and atmospheric light."
- **STYLE_TAIL:** "Muted, restrained colours with earthy umber and ochre tones and small touches of rust red; aerial
  perspective; quiet, solemn mood."
- **NEGATIVE:** text, letters, words, writing, inscription, signature, watermark, caption, signboard, frame, border,
  photograph, photorealistic, 3d render, CGI, modern objects, cars, electric lights, electric pylons, close-up faces,
  portrait, gore, blood, deformed figures, extra limbs, crosses, crescents, religious symbols, national flags, emblems,
  onion domes, pyramids, ziggurats, pagodas, cathedral, oversaturated, cartoon, anime, blurry.
- **Era guards (added to the negative):**

  | Era | Excluded |
  |---|---|
  | bronze | tile roofs, iron, armour plates, crossbows, gunpowder smoke, cannons, guns, chimneys, paper, books |
  | iron | crossbows, plate armour, gunpowder smoke, cannons, guns, chimneys, books, candles |
  | medieval | gunpowder smoke, cannons, guns, muskets, factory chimneys, printed paper, church, cathedral |
  | earlymodern | factory chimneys, railways, trains, rifles, telegraph poles, top hats, church, cathedral |
  | industrial | cars, trucks, tanks, aeroplanes, electric street lights, typewriter, telephone |

- **Era kits (in the scene text):**

  | Era | City | Troops | On the scribe's desk |
  |---|---|---|---|
  | bronze | mud brick, flat roofs | chariots, bronze spears, wicker shields | clay tablets, reed stylus, clay saucer lamp |
  | iron | stone walls, round towers | iron helmets, round shields, cavalry | papyrus rolls, reed pen, clay lamp |
  | medieval | tile roofs, square towers, battlements | crossbows, mounted knights | parchment, quill, candle |
  | earlymodern | low angled brick bastions | musketeers, pikes, cannon, gunpowder smoke | paper, printed sheets face down, quill, oil lamp |
  | industrial | brick, factory chimneys, railway, telegraph wires | riflemen in greatcoats, field guns, a locomotive | ledgers, dip pen, kerosene lamp |

- **Light per beat:**

  | Beat | Light |
  |---|---|
  | muster | pale golden morning |
  | field | hazy ochre dust |
  | walls | slate-blue dusk with a ring of campfires |
  | sack | black, umber and fire |
  | treaty | cold grey dawn |
  | tablet | warm lamplight against a blue night window |

- **Fixed seeds per beat:** muster 1101, field 2202, walls 3303, sack 4404, treaty 5505, tablet 6606; titles 7707,
  7808, 7909. An alternate is the base seed + n.
- **Sampling:** 1280×720 (Wan's native 720p), 20 steps (10 high-noise, 10 low-noise expert), euler / simple, shift 8,
  CFG 3.5.
- **Encoding:** trim a 6/4 px edge to 1268×713 (16:9), Lanczos to 1536×864 and 768×432, then cwebp `-q 82 -m 6
  -sharp_yuv`. The encoder steps quality down if a file would exceed 220 KB; none needed to.

## Review log (every image was inspected, plus its bottom 64 px under auto-contrast for lettering)

**Kept from the first pass (base seed):** all of muster, field, walls and sack in every era; bronze-treaty;
industrial-tablet, iron-tablet, medieval-tablet; title-city.

**Rejected and replaced:**

| Image | Rejected render: reason | Picked |
|---|---|---|
| bronze-tablet | s6606: glazed sash window, pitched roofs, metal lantern, pebble-like "tablets" (scene rewritten); s6607: unpainted canvas border; s6609 / s6610 (a third wording): soap-bar and river-pebble shapes | **s6608**: grey clay tablets, reed stylus, clay saucer lamp, mud-brick opening |
| iron-treaty | s5505: an official in what reads as a modern suit, large foreground figures; s5506: large foreground figures with faces | **s5507**: small hooded figures from behind, white banners, round-towered gate |
| medieval-treaty | s5505: three officials in modern suits and ties; s5506: larger foreground riders | **s5507**: riders from behind, rust banners, tile-roofed town |
| earlymodern-treaty | s5505 and s5506: crowds of mid-sized figures with faces | **s5507**: nearest figures seen from behind, brick gate, plain banners |
| industrial-treaty | s5505: figures too large and close; s5507: weaker composition | **s5506**: gate, white banners, telegraph wires, chimneys |
| earlymodern-tablet | s6606: handwriting-like scribbles on the sheets, a metal-nib pen; s6607: scribbled sheets again | **s6608**: blank sheets, goose quills, oil lamps |
| title-hands | s7707: white painted border, slate-tray "tablet", knitted cuffs; s7708 and s7709: white borders, a tray with studs; s7710: the clay painted as a stitched cushion | **s7711**: cropped inside its unpainted margin |
| title-ash | s7909: a cartoon terracotta tray; s7910: brick-like blocks; s7912 and s7913 (a chiaroscuro wording): cheese-like blocks | **s7911**: a cracked fired-clay slab and a broken wedge in ash. I first rejected it as "wood-like", then picked it after comparing all six. It is still the weakest plate. |
| earlymodern-sack | kept s4404; the alternates s4405 and s4406 gave the gate curved, pagoda-like roofs (real-world iconography) | **s4404** |
| earlymodern-muster | kept s1101; an amended prompt asking for an angled brick bastion (s1102) still painted crenellated walls, with larger figures | **s1101** |

**Retouching:** 16 published images had a small painted signature in a bottom corner, covered by a feathered clone of
the canvas beside it. These are listed in `RETOUCH` and flagged `retouch` in `art.json`:
- title-city
- bronze-field, bronze-treaty, bronze-tablet
- iron-field, iron-treaty
- medieval-field, medieval-sack, medieval-treaty
- earlymodern-sack, earlymodern-treaty, earlymodern-tablet
- industrial-muster, industrial-sack, industrial-treaty, industrial-tablet

title-hands is cropped inside an unpainted margin (`CROP`, flagged `crop`, a 1.35× upscale).

**Known compromises:**
- **earlymodern-muster's gate** is a tall crenellated gatehouse, not a bastion. Old curtain walls are period-plausible,
  and the star bastions show clearly in earlymodern-walls.
- **The earlymodern-tablet lamps** have glass chimneys, which are late (about 1780s) for the age.
- **Small figures are painterly**, not anatomically exact; none is mangled at display size.

**FLUX.1 [schnell] tests:** about 28 trial renders (three style wordings, CFG 1 and 2, two passes over eight scenes),
all rejected; none is published.

## Regenerating
```sh
node scripts/art/tablet-art.ts prompts                       # every prompt and negative
node scripts/art/tablet-art.ts gen [--only=ids|eras|beats] [--from=n --seeds=k] [--force]   # ComfyUI on :8188
node scripts/art/tablet-art.ts process [--partial]           # picks → atlas/public/game/art + art.json
```
Raw renders and their prompt sidecars are kept in `build/art/raw/`, which is gitignored; rejected renders are in
`build/art/rejected/`. Picks (`PICKS`), scene overrides (`SCENE`, `AMEND`), negative additions (`NEG_AMEND`),
signature retouches (`RETOUCH`) and crops (`CROP`) are recorded in the script, each with a comment saying why.
