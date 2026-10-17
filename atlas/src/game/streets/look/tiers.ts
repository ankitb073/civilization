// Look: which renderer and quality tier the streets use (decision 0033). Small and free of three.js, so the choice is
// made before the WebGPU renderer and the look's code (their own lazy chunks) are fetched.
//
// - No WebGPU (navigator.gpu missing, no adapter, or only a software one): the classic look on WebGLRenderer, exactly
//   as before. The realism look is never drawn on WebGPURenderer's WebGL2 backend: look-dev measured its shaders at a
//   21 s compile there.
// - WebGPU: the realism look, in one of four tiers, picked from the device and a short GPU probe (a fixed fragment
//   workload, timed; well under 0.2 s):
//     desktop          discrete and fast integrated GPUs (score ≥ 0.33 of the M5 Max this was tuned on)
//     desktop-medium   other computers (integrated GPUs: M1, Iris Xe, about a sixth of that Mac)
//     phone            phones whose GPU scores like a computer's integrated one (score ≥ 0.12): 30 fps lock
//     phone-low        every other phone (the default on phones), aiming for 60 fps
// - Overrides: ?look=classic|realism and ?tier=desktop|desktop-medium|phone|phone-low in the route; else the
//   player's own choice from the HUD menu (localStorage, inside try/catch); else the detection.

export type TierName = 'desktop' | 'desktop-medium' | 'phone' | 'phone-low';
export const TIER_NAMES: readonly TierName[] = ['desktop', 'desktop-medium', 'phone', 'phone-low'];
/** What the player can pick in the HUD menu: automatic, a tier, or the classic (painted) look. */
export type LookChoice = 'auto' | 'classic' | TierName;
export const LOOK_CHOICES: readonly LookChoice[] = ['auto', 'desktop', 'desktop-medium', 'phone', 'phone-low', 'classic'];
export const CHOICE_LABEL: Record<LookChoice, string> = {
  auto: 'Automatic', desktop: 'Ultra', 'desktop-medium': 'High', phone: 'Medium (30 fps)', 'phone-low': 'Low', classic: 'Classic',
};
export const CHOICE_NOTE: Record<LookChoice, string> = {
  auto: 'Chosen for this device; lowered by itself if frames run slow',
  desktop: 'Every effect, 2K surfaces',
  'desktop-medium': 'For laptops: fewer effects, 1K surfaces',
  phone: 'Phone surfaces and shadows, ambient occlusion, held at 30 fps',
  'phone-low': 'The lightest realistic look, for 60 fps on phones',
  classic: 'The painted look, without WebGPU (reloads the city)',
};

const KEY = 'pal-streets-look-v1';

export function readChoice(): LookChoice {
  try {
    const v = localStorage.getItem(KEY) as LookChoice | null;
    return v && (LOOK_CHOICES as readonly string[]).includes(v) ? v : 'auto';
  } catch { return 'auto'; }
}
export function saveChoice(c: LookChoice) {
  try { if (c === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, c); } catch { /* storage blocked: the choice lasts this visit */ }
}

/** The next tier down (adaptive quality), or null at the bottom. */
export function tierBelow(t: TierName): TierName | null {
  return t === 'desktop' ? 'desktop-medium' : t === 'desktop-medium' ? 'phone' : t === 'phone' ? 'phone-low' : null;
}

export interface GpuProbe {
  /** Best of three timed runs of the probe workload (ms), and the score against the reference machine (1 = it). */
  ms: number;
  score: number;
  vendor: string;
  architecture: string;
  fallback: boolean;
  /** How long the probe took in all (device, compile, runs), ms. */
  totalMs: number;
}

export interface LookPick {
  look: 'classic' | 'realism';
  tier: TierName | null;
  /** Why: 'url', 'choice', 'auto' or a reason for the classic look ('no-webgpu', 'no-adapter', 'software'). */
  why: string;
  choice: LookChoice;
  gpu: GpuProbe | null;
}

/** The probe workload's best time on the reference machine (Apple M5 Max, Chromium, WebGPU), ms. */
export const PROBE_REF_MS = 4.3;
const DESKTOP_MIN = 0.33, PHONE_MIN = 0.12;

/** Pick the look and tier for this visit. `mobile`: a touch phone or a narrow window (StreetsView's own test). */
export async function pickLook(params: URLSearchParams, mobile: boolean): Promise<LookPick> {
  const urlLook = params.get('look');
  const urlTier = params.get('tier') as TierName | null;
  const choice = readChoice();
  if (urlLook === 'classic' || (!urlLook && !urlTier && choice === 'classic')) {
    return { look: 'classic', tier: null, why: urlLook ? 'url' : 'choice', choice, gpu: null };
  }
  const gpuApi = typeof navigator !== 'undefined' ? (navigator as Navigator & { gpu?: GPU }).gpu : undefined;
  if (!gpuApi) return { look: 'classic', tier: null, why: 'no-webgpu', choice, gpu: null };
  let adapter: GPUAdapter | null = null;
  try { adapter = await gpuApi.requestAdapter({ powerPreference: 'high-performance' }); } catch { adapter = null; }
  if (!adapter) return { look: 'classic', tier: null, why: 'no-adapter', choice, gpu: null };
  const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
  const fallback = !!((info as unknown as { isFallbackAdapter?: boolean })?.isFallbackAdapter ?? (adapter as unknown as { isFallbackAdapter?: boolean }).isFallbackAdapter);
  if (fallback && !urlTier && urlLook !== 'realism') return { look: 'classic', tier: null, why: 'software', choice, gpu: null };
  if (urlTier && (TIER_NAMES as readonly string[]).includes(urlTier)) return { look: 'realism', tier: urlTier, why: 'url', choice, gpu: null };
  if (choice !== 'auto' && choice !== 'classic') return { look: 'realism', tier: choice, why: 'choice', choice, gpu: null };
  const gpu = await probeGpu(adapter, info, fallback).catch(() => null);
  const score = gpu?.score ?? 0;
  const tier: TierName = mobile ? (score >= PHONE_MIN ? 'phone' : 'phone-low') : score >= DESKTOP_MIN || !gpu ? 'desktop' : 'desktop-medium';
  return { look: 'realism', tier, why: 'auto', choice, gpu };
}

/** A short GPU probe: a full-screen fragment workload (ALU, half-float writes) drawn 8 times into a 1024² target,
 *  timed by the queue (best of three, after one run to compile). Its own device, destroyed after. */
async function probeGpu(adapter: GPUAdapter, info: GPUAdapterInfo | undefined, fallback: boolean): Promise<GpuProbe> {
  const t0 = performance.now();
  const device = await adapter.requestDevice();
  try {
    const U = (globalThis as unknown as { GPUTextureUsage: { RENDER_ATTACHMENT: number } }).GPUTextureUsage;
    const size = 1024;
    const tex = device.createTexture({ size: [size, size], format: 'rgba16float', usage: U.RENDER_ATTACHMENT });
    const module = device.createShaderModule({
      code: /* wgsl */ `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  var a = vec4f(pos.xy * 0.00097, 0.31, 0.73);
  for (var k = 0; k < 64; k++) { a = fract(a * a.wzyx * 1.37 + vec4f(0.11, 0.23, 0.31, 0.47)); }
  return a;
}`,
    });
    const pipe = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
    });
    const view = tex.createView();
    const run = async (passes: number) => {
      const enc = device.createCommandEncoder();
      for (let p = 0; p < passes; p++) {
        const pass = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
        pass.setPipeline(pipe);
        pass.draw(3);
        pass.end();
      }
      const s = performance.now();
      device.queue.submit([enc.finish()]);
      await device.queue.onSubmittedWorkDone();
      return performance.now() - s;
    };
    await run(1);
    let best = Infinity;
    for (let i = 0; i < 3; i++) best = Math.min(best, await run(8));
    tex.destroy();
    return {
      ms: Math.round(best * 100) / 100, score: Math.round((PROBE_REF_MS / Math.max(0.05, best)) * 1000) / 1000,
      vendor: info?.vendor ?? '', architecture: info?.architecture ?? '', fallback, totalMs: Math.round(performance.now() - t0),
    };
  } finally {
    device.destroy();
  }
}
