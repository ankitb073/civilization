// The stage behind the game: the painted scene art for the day's beat (atlas/public/game/art, Ken Burns drift,
// cross-fading between beats), the 3D backdrop of the city (backdrop.ts) for the establishing moments and for any
// beat without art, and a calm painted gradient under everything, so the game looks right before (or without) either.
// Both are optional modules, loaded lazily and discovered at build time: the game never waits for them.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Beat, Scenario } from './types.ts';
import { eraOf, type Era } from './engine.ts';

/** The backdrop's and the soundscape's beat names. */
export type SceneBeat = 'muster' | 'field' | 'walls' | 'fall-sack' | 'fall-treaty' | 'held' | 'tablet' | 'ending';
export function sceneBeat(b: Beat): SceneBeat {
  return b === 'title' ? 'muster' : b === 'sack' ? 'fall-sack' : b === 'treaty' ? 'fall-treaty' : b;
}

// ---------------------------------------------------------------- the art manifest

export interface ArtEntry { era: string; beat: string; file: string; mobile?: string; alt?: string; video?: string; loop?: string; poster?: string }
let artP: Promise<ArtEntry[]> | null = null;
const ART_DIR = `${import.meta.env.BASE_URL}game/art/`;
export function loadArt(): Promise<ArtEntry[]> {
  if (!artP) {
    artP = fetch(`${ART_DIR}art.json`).then((r) => (r.ok ? r.json() : [])).then((j: unknown) => {
      const list = Array.isArray(j) ? j : (j && typeof j === 'object' && Array.isArray((j as { art?: unknown }).art) ? (j as { art: unknown[] }).art : []);
      return (list as ArtEntry[]).filter((e) => e && typeof e.file === 'string' && typeof e.beat === 'string');
    }).catch(() => []);
  }
  return artP;
}
const artUrl = (f: string) => (/^(https?:)?\/\//.test(f) || f.startsWith('/') ? f : ART_DIR + f.replace(/^\.?\//, '').replace(/^game\/art\//, ''));

/** The art's beat for a game beat: the conquest is told at the gate, like a treaty; the city that held, on its walls. */
const ART_BEAT: Record<Beat, string[]> = {
  title: ['title', 'muster'], muster: ['muster'], field: ['field'], walls: ['walls'], sack: ['sack'], treaty: ['treaty'],
  held: ['held', 'walls'], tablet: ['tablet'], ending: ['ending', 'tablet'],
};
export function artFor(list: ArtEntry[], era: Era, beat: Beat): ArtEntry | null {
  const ERAS: Era[] = ['bronze', 'iron', 'medieval', 'earlymodern', 'industrial'];
  const near = [...ERAS].sort((a, b) => Math.abs(ERAS.indexOf(a) - ERAS.indexOf(era)) - Math.abs(ERAS.indexOf(b) - ERAS.indexOf(era)));
  for (const b of ART_BEAT[beat]) {
    const exact = list.find((e) => e.era === era && e.beat === b);
    if (exact) return exact;
  }
  // a neighbouring era's painting of the same beat is better than none, but only one era away
  for (const b of ART_BEAT[beat]) for (const e of near.slice(1, 2)) { const hit = list.find((x) => x.era === e && x.beat === b); if (hit) return hit; }
  return null;
}

// ---------------------------------------------------------------- the optional backdrop module

interface BackdropHandle { setBeat(b: SceneBeat, o?: { instant?: boolean }): void; dispose(): void }
type MountFn = (el: HTMLElement, s: Scenario, beat: SceneBeat, o?: { reducedMotion?: boolean }) => Promise<BackdropHandle>;
const backdropMods = import.meta.glob<{ mountBackdrop?: MountFn }>('./backdrop.ts');
let mountP: Promise<MountFn | null> | null = null;
function loadBackdrop(): Promise<MountFn | null> {
  if (!mountP) {
    const load = Object.values(backdropMods)[0];
    mountP = load ? load().then((m) => m.mountBackdrop ?? null).catch(() => null) : Promise.resolve(null);
  }
  return mountP;
}

// ---------------------------------------------------------------- the stage

interface StageProps { scenario: Scenario; beat: Beat; /** The establishing shots (title, ending): the 3D city, not a painting. */ establishing: boolean; reduced: boolean }

export function Stage({ scenario, beat, establishing, reduced }: StageProps) {
  const [art, setArt] = useState<ArtEntry[] | null>(null);
  const [narrow, setNarrow] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 700px)').matches);
  useEffect(() => { loadArt().then(setArt); }, []);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const m = matchMedia('(max-width: 700px)');
    const on = (e: MediaQueryListEvent) => setNarrow(e.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  const era = eraOf(scenario);
  const entry = art && !establishing ? artFor(art, era, beat) : null;
  const wantBackdrop = establishing || (art !== null && !entry);

  // the painting layers: the new one fades in on top of the last, which is then dropped
  const [layers, setLayers] = useState<{ key: string; e: ArtEntry; on: boolean }[]>([]);
  const entryKey = entry ? `${entry.era}-${entry.beat}` : '';
  useEffect(() => {
    if (!entry) { setLayers((ls) => ls.map((l) => ({ ...l, on: false }))); return; }
    setLayers((ls) => (ls.length && ls[ls.length - 1].key === entryKey ? ls : [...ls, { key: entryKey, e: entry, on: false }]));
  }, [entryKey]);
  const onLoaded = (key: string) => setLayers((ls) => ls.map((l) => (l.key === key ? { ...l, on: true } : l)));
  const onFailed = (key: string) => setLayers((ls) => ls.filter((l) => l.key !== key));
  useEffect(() => {
    const top = layers[layers.length - 1];
    if (!layers.length || (top.on && layers.length === 1)) return;
    const t = setTimeout(() => setLayers((ls) => {
      const last = ls[ls.length - 1];
      if (!last) return ls;
      return last.on ? [last] : ls.filter((l) => l === last);
    }), 1700);
    return () => clearTimeout(t);
  }, [layers]);

  // the 3D city, mounted only while it is wanted
  const host = useRef<HTMLDivElement>(null);
  const bd = useRef<BackdropHandle | null>(null);
  const [bdOn, setBdOn] = useState(false);
  useEffect(() => {
    if (!wantBackdrop || !host.current) return;
    let alive = true;
    const el = host.current;
    loadBackdrop().then(async (mount) => {
      if (!mount || !alive) return;
      try {
        const h = await mount(el, scenario, sceneBeat(beat), { reducedMotion: reduced });
        if (!alive) { h.dispose(); return; }
        bd.current = h;
        setBdOn(true);
      } catch { /* keep the painted gradient */ }
    });
    return () => { alive = false; bd.current?.dispose(); bd.current = null; setBdOn(false); };
  }, [wantBackdrop, scenario.id]);
  useEffect(() => { bd.current?.setBeat(sceneBeat(beat)); }, [beat, bdOn]);

  return (
    <div class={`tb-stage tb-stage--${beat}${reduced ? ' is-still' : ''}`} aria-hidden="true">
      <div class="tb-stage__sky" />
      <div class={`tb-stage__bd${bdOn && wantBackdrop ? ' is-on' : ''}`} ref={host} />
      {layers.map((l) => {
        const src = artUrl(narrow && l.e.mobile ? l.e.mobile : l.e.file);
        return (
          <div class={`tb-stage__art${l.on ? ' is-on' : ''}`} key={l.key}>
            {(l.e.video ?? l.e.loop) && !reduced
              ? <video src={artUrl((l.e.video ?? l.e.loop)!)} poster={src} autoPlay muted loop playsInline onLoadedData={() => onLoaded(l.key)} onError={() => onFailed(l.key)} />
              : <img src={src} alt="" decoding="async" onLoad={() => onLoaded(l.key)} onError={() => onFailed(l.key)} />}
          </div>
        );
      })}
      <div class="tb-stage__veil" />
      <div class="tb-stage__grain" />
    </div>
  );
}
