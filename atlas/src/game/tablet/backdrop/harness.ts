// Dev harness for the Tablet House backdrop (atlas/dev/backdrop.html, Vite dev server only):
//   /dev/backdrop.html?sc=0&beat=walls[&rm=1][&webgl=0][&ui=0]
// Three real sieges from the record (seed 5) stand in until scenarios.json exists; with it, its scenarios follow.
// window.__bd exposes the handle for atlas/scripts/shoot-backdrop.ts.

import { BEATS, mountBackdrop, type Backdrop, type BackdropScenario, type Beat } from '../backdrop.ts';
import { firstPaint } from '../../../store.ts';

/** Real sieges, facts from build/world.sqlite (seed 5): the defender is "state", the besieger "enemy". */
export const FIXTURES: BackdropScenario[] = [
  {
    // evt:1178 First Sack of Tivintukhe, AY 402 (Age of Bronze): after the Battle of Dainagafu (evt:1177)
    id: 'sc-1178', year: 402,
    city: { id: 'set:13', name: 'Tivintukhe', pop: 21753, cell: 5792, port: true },
    state: { id: 'pol:13', name: 'Kingdom of Tivintusa' },
    enemy: { id: 'pol:42', name: 'Kingdom of Nimiti' },
    battle: { id: 'evt:1177', place: 'Dainagafu', theirs: 1659, ours: 831, cell: 5563 },
    outcome: 'sacked', burnedArchives: false, camera: null,
  },
  {
    // evt:41480 Fifth Sack of Imshi, AY 4327 (Age of Parchment and Plough): archives burned
    id: 'sc-41480', year: 4327,
    city: { id: 'set:116', name: 'Imshi', pop: 119650, cell: 1628, port: false },
    state: { id: 'pol:1716', name: 'City-State of Iith' },
    enemy: { id: 'pol:1521', name: 'Kingdom of Ayshi' },
    battle: { id: 'evt:41479', place: 'Imshi', theirs: 53616, ours: 1904, cell: 1742 },
    outcome: 'sacked', burnedArchives: true, camera: null,
  },
  {
    // evt:47732 Siege of Kavu, AY 4926 (Age of Engines): after the Battle of Dunjinil (evt:47731), conquered
    id: 'sc-47732', year: 4926,
    city: { id: 'set:25', name: 'Kavu', pop: 2652468, cell: 1554, port: true },
    state: { id: 'pol:1826', name: 'Kingdom of Luthe' },
    enemy: { id: 'pol:1638', name: 'Khishkhis Empire' },
    battle: { id: 'evt:47731', place: 'Dunjinil', theirs: 1601973, ours: 115308, cell: 1438 },
    outcome: 'conquered', burnedArchives: false, camera: null,
  },
];

interface Harness { handle: Backdrop | null; ready: Promise<Backdrop>; scenarios: BackdropScenario[]; scenario: BackdropScenario }

async function main() {
  const q = new URLSearchParams(location.search);
  firstPaint.value = true;
  let scenarios = FIXTURES.slice();
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}data/scenarios.json`);
    if (r.ok) {
      const j = (await r.json()) as { scenarios?: BackdropScenario[] } | BackdropScenario[];
      const list = Array.isArray(j) ? j : j.scenarios ?? [];
      scenarios = scenarios.concat(list.filter((s) => !scenarios.some((f) => f.id === s.id)));
    }
  } catch { /* fixtures only */ }
  const want = q.get('sc') ?? '0';
  const sc = scenarios.find((s) => s.id === want) ?? scenarios[Math.max(0, Math.min(scenarios.length - 1, Number(want) || 0))];
  const beat = (BEATS.includes(q.get('beat') as Beat) ? q.get('beat') : 'muster') as Beat;
  const stage = document.getElementById('stage')!;
  const H = { handle: null, scenarios, scenario: sc } as unknown as Harness;
  H.ready = mountBackdrop(stage, sc, beat, {
    reducedMotion: q.get('rm') === '1' ? true : undefined,
    webgl: q.get('webgl') === '0' ? false : undefined,
  }).then((h) => { H.handle = h; return h; });
  (window as unknown as { __bd: Harness }).__bd = H;

  if (q.get('ui') === '0') return;
  const bar = document.getElementById('bar')!;
  const label = document.createElement('div');
  label.className = 'lab';
  label.textContent = `${sc.city.name}, AY ${sc.year} · ${sc.outcome}`;
  bar.appendChild(label);
  const sel = document.createElement('select');
  scenarios.forEach((s, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = `${s.city.name} AY ${s.year}`; if (s === sc) o.selected = true; sel.appendChild(o); });
  sel.onchange = () => { q.set('sc', sel.value); location.search = q.toString(); };
  bar.appendChild(sel);
  for (const b of BEATS) {
    const btn = document.createElement('button');
    btn.textContent = b;
    btn.onclick = () => { H.handle?.setBeat(b); q.set('beat', b); history.replaceState(null, '', `?${q.toString()}`); };
    bar.appendChild(btn);
  }
  const fps = document.createElement('div');
  fps.className = 'lab';
  bar.appendChild(fps);
  setInterval(() => {
    const st = H.handle?.stats;
    if (!st || !st.frame.length) return;
    const a = st.frame.slice(-120).sort((x, y) => x - y);
    fps.textContent = `${H.handle!.mode} · median ${a[a.length >> 1].toFixed(1)} ms · dpr ${st.dpr} · ${st.city}`;
  }, 1000);
}

void main();
