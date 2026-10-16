# 0029: Painted scene art for the Tablet House, made locally with Wan 2.2 A14B

**Context.** The Tablet House (0028) puts a painting behind each day: five eras by six beats, plus three title plates.
The art must look like plates from one illustrated history book. It must not carry lettering, modern objects,
anachronisms or real-world iconography (the world is fictional). It must be small enough for phones. It must be made
with a permissively licensed model on the local Mac, never a hosted service.

**Decision.**
- **Model:** Wan 2.2 T2V A14B (Apache-2.0), sampled as a one-frame video at 1280×720 on the local ComfyUI (about 3.4
  minutes per image on an M5 Max).
  - The brief's first choice, Wan 2.2 TI2V 5B, renders noise on MPS.
  - The fallback, FLUX.1 [schnell] (Apache-2.0, downloaded), paints signatures and lettering, slips in anachronisms and
    ignores negative prompts.
  - The comparison is in `docs/art/ART.md`.
- **One locked style:**
  - A fixed style head and tail around every scene.
  - A fixed negative prompt plus per-era anachronism guards.
  - A fixed seed per beat, so a beat's five eras share their starting noise.
  - The generator is `scripts/art/tablet-art.ts`. Each render's exact prompt, negative, seed and sampling go into
    `atlas/public/game/art/art.json`.
- **Every image was reviewed by eye**, including its bottom band at high contrast.
  - Rejects were re-rendered from new seeds or reworded prompts: 8 of 33.
  - Picks, overrides and the reason for each live in the script.
  - Small painted corner signatures (16 images) are covered by feathered clone patches recorded per render, not by
    regenerating.
- **Delivery:** 1536×864 WebP at quality 82 with a 768×432 phone copy: 2.7 MB and 0.7 MB for all 33.
- **No video loops for now** (issue #50): the 5B model that would make them is broken on MPS.

**Why.**
- **Reader interest and habit:** a painted city behind each day makes the five days feel like a place, and five eras
  make "another city" look different, not just read differently.
- **Credibility:** no lettering, no modern objects, no real nations' symbols. A fictional world's art that showed a
  cathedral or a pagoda would undercut the archive's claim to be its own world.
- **Speed:** a median of 82 KB per full image and 22 KB on phones; the stage loads the phone copy under 700 px.
- **Reproducible and owned:** a local, Apache-2.0 model, with every prompt and seed recorded and one script to
  regenerate. Moving a seed or rewording a scene is a one-line change with its reason beside it.
