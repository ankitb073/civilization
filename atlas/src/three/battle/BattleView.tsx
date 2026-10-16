// #/battle/evt:N — a battle as a tabletop diorama, replayed from the record: the armies advance, the winner's line
// holds, each side thins by exactly its recorded losses, the loser falls back. Beside it, the record's figures and
// what each surviving document claimed, drawn as ghost armies at the same scale. Lazy-loaded with three.js.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { effect } from '@preact/signals';
import type { BattleClaim, BattleJson, PageJson } from '../../../../engine/src/export/contract.ts';
import { fetchJson, loadPage, loadWorld } from '../../data.ts';
import { buildGeo, type Geo } from '../../geo.ts';
import type { TlCore } from '../../tl.ts';
import { isMobile, pageHref, reducedMotion, route, theme } from '../../state.ts';
import { armsSvg, sigilSvg } from '../../heraldry.ts';
import { buildBoard } from './board.ts';
import { MACHINE, planBattle, phaseLabel, stray, tally, TROOP_NAME, type BattlePlan, type GhostPlan } from './plan.ts';
import { BattleScene } from './scene.ts';
import './battle.css';

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const linkText = (v: string | undefined) => v?.match(/\[\[[^|\]]+\|([^\]]+)\]\]/)?.[1] ?? v ?? '';
const linkId = (v: string | undefined) => v?.match(/\[\[([^|\]]+)\|/)?.[1] ?? null;
const box = (p: PageJson, k: string) => p.infobox.find(([l]) => l === k)?.[1];

let geoCache: { world: Awaited<ReturnType<typeof loadWorld>>; geo: Geo } | null = null;

const KIND: Record<BattleClaim['kind'], string> = { chronicle: 'Chronicle', stele: 'Victory stele', telegram: 'Telegram', newspaper: 'Newspaper', muster: 'Muster roll' };

interface Loaded { page: PageJson; b: BattleJson; plan: BattlePlan; town: { name: string; cell: number; pop: number } | null; world: Awaited<ReturnType<typeof loadWorld>>; geo: Geo }

export function BattleView({ id }: { id: string }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ghost, setGhost] = useState(-1);
  const [ready, setReady] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<BattleScene | null>(null);
  const params = route.value.params;

  // ---- load the battle page, the world and the town
  useEffect(() => {
    let dead = false;
    setData(null); setErr(null); setReady(false);
    (async () => {
      const page = await loadPage(id);
      if (!page || page.sub !== 'battle' || !page.battle) throw new Error(page ? 'This page is not a battle with a diorama.' : 'No such battle in the archive.');
      if (!geoCache) { const world = await loadWorld(); geoCache = { world, geo: buildGeo(world) }; }
      const nearId = linkId(box(page, 'Near'));
      let town: Loaded['town'] = null;
      if (nearId) {
        // the timeline core is usually cached by the map already; the town's own page will do otherwise
        const core = await fetchJson<TlCore>('tl/core.json').catch(() => null);
        const st = core?.settlements.find((x) => x.id === nearId);
        if (st) town = { name: st.name, cell: st.cell, pop: page.battle.town };
        else {
          const tp = await loadPage(nearId).catch(() => null);
          if (tp && tp.cell >= 0) town = { name: tp.title, cell: tp.cell, pop: page.battle.town };
        }
      }
      const plan = planBattle(page.id, page.battle);
      if (!dead) setData({ page, b: page.battle, plan, town, ...geoCache });
    })().catch((e) => { if (!dead) setErr(String((e as Error)?.message ?? e)); });
    return () => { dead = true; };
  }, [id]);

  const page = data?.page;
  const sides = useMemo(() => {
    if (!page) return null;
    return [0, 1].map((s) => ({
      name: linkText(box(page, s === 0 ? 'Attacker' : 'Defender')),
      id: linkId(box(page, s === 0 ? 'Attacker' : 'Defender')),
      commander: linkText(box(page, s === 0 ? 'Commander (attack)' : 'Commander (defence)')),
      commanderId: linkId(box(page, s === 0 ? 'Commander (attack)' : 'Commander (defence)')),
    })) as [{ name: string; id: string | null; commander: string; commanderId: string | null }, { name: string; id: string | null; commander: string; commanderId: string | null }];
  }, [page]);

  useEffect(() => {
    if (page) document.title = `${page.title}, as a diorama — Palimpsest`;
  }, [page]);

  // the ghost a link asks for, else the boldest claim
  const ghostOrder = useMemo(() => {
    if (!data) return [] as number[];
    return data.plan.ghosts.map((g, i) => [i, stray(g.claim, data.b)] as const).sort((a, b) => b[1] - a[1]).map(([i]) => i);
  }, [data]);

  // ---- the scene
  useEffect(() => {
    if (!data || !canvasRef.current || !labelsRef.current || !sides) return;
    let scene: BattleScene;
    const cleanups: (() => void)[] = [];
    let disposed = false;
    const timer = window.setTimeout(() => {
      if (disposed) return;
      try {
        const t0 = performance.now();
        const board = buildBoard(data.world, data.geo, data.page.cell, data.town?.cell ?? null, data.page.id);
        const boardMs = performance.now() - t0;
        scene = new BattleScene(canvasRef.current!, labelsRef.current!, data.plan, data.b, board, {
          title: data.page.title.replace(/\s*\(AY \d+\)$/, ''),
          year: data.page.t0,
          sides: [0, 1].map((s) => ({ name: sides[s].name, arms: data.b.arms[s], seal: data.b.seals[s], commander: sides[s].commander })) as never,
          town: data.town ? { name: data.town.name, pop: data.town.pop } : null,
        }, { theme: theme.peek(), mobile: isMobile.peek(), reducedMotion });
        scene.stats.build += boardMs;
      } catch (e) {
        setErr(String((e as Error)?.message ?? e));
        return;
      }
      sceneRef.current = scene;
      (window as unknown as { __battle?: BattleScene }).__battle = scene;
      let lastT = -1;
      scene.onTime = (tt) => { if (Math.abs(tt - lastT) > 0.004 || tt === 0 || tt === 1) { lastT = tt; setT(tt); } };
      scene.onEnd = () => setPlaying(false);
      const want = params.get('ghost');
      const g0 = want === 'none' ? -1 : want !== null ? Math.min(data.plan.ghosts.length - 1, Number(want)) : (ghostOrder[0] ?? -1);
      setGhost(g0);
      scene.setGhost(g0);
      scene.resize();
      const tParam = params.get('t');
      const still = params.get('still') === '1' || tParam !== null;
      scene.setTime(tParam !== null ? Number(tParam) : reducedMotion ? 1 : 0);
      scene.start();
      setReady(true);
      if (!still && !reducedMotion) {
        const go = window.setTimeout(() => { scene.play(); setPlaying(true); }, 900);
        cleanups.push(() => clearTimeout(go));
      }
      const ro = new ResizeObserver(() => scene.resize());
      ro.observe(wrapRef.current!);
      cleanups.push(() => ro.disconnect());
      cleanups.push(effect(() => { scene.setTheme(theme.value); }));
    }, 20);
    return () => {
      disposed = true;
      clearTimeout(timer);
      cleanups.forEach((f) => f());
      sceneRef.current?.dispose();
      sceneRef.current = null;
      delete (window as unknown as { __battle?: BattleScene }).__battle;
    };
  }, [data, sides]);

  if (err) return <div class="bt bt--msg"><p>{err}</p><p><a href={pageHref(id)}>Back to the page</a></p></div>;

  const s = sceneRef.current;
  const toggle = () => {
    if (!s) return;
    if (playing) { s.pause(); setPlaying(false); } else { s.play(); setPlaying(true); }
  };
  const scrub = (v: number) => { if (!s) return; s.pause(); setPlaying(false); s.setTime(v); };
  const pickGhost = (i: number) => { setGhost(i); s?.setGhost(i); };

  const b = data?.b, plan = data?.plan;
  const phase = phaseLabel(t);
  const winner = b && sides ? sides[b.won] : null, loser = b && sides ? sides[1 - b.won] : null;
  const caption = !b || !sides ? '' : phase === 'array' ? `The armies draw up: ${fmt(b.size[0])} men of ${sides[0].name} against ${fmt(b.size[1])} of ${sides[1].name}.`
    : phase === 'advance' ? 'The armies advance.'
      : phase === 'melee' ? `The lines meet. ${winner!.name}${b.won === 1 ? ' holds its ground' : ' presses on'}.`
        : phase === 'rout' ? `${loser!.name} falls back${b.decisive > 0.6 ? ' in disorder' : ''}.`
          : `${winner!.name} holds the field. ${b.decisive > 0.6 ? 'The result was decisive.' : b.decisive < 0.25 ? 'The result was narrow.' : ''}`;

  return (
    <div class="bt">
      <div class={`bt__stage${ready ? ' is-ready' : ''}`} ref={wrapRef}>
        <canvas ref={canvasRef} class="bt__canvas" tabIndex={0} role="img"
          aria-label={page ? `A diorama of the ${page.title}: two armies on the ground where it was fought. Drag to turn, scroll or pinch to zoom.` : 'Battle diorama'} />
        <div class="bt__labels" ref={labelsRef} aria-hidden="true" />
        {ready && data && sides && ghost >= 0 && data.plan.ghosts[ghost] && (
          <div class="bt__ghost" dangerouslySetInnerHTML={{ __html: ghostCaption(data.plan.ghosts[ghost], data, sides) }} />
        )}
        {!ready && <div class="bt__loading"><div class="spinner" /> Setting out the armies…</div>}
        {ready && b && (
          <div class="bt__bar">
            <button class="bt__play" onClick={toggle} aria-label={playing ? 'Pause the replay' : t >= 0.999 ? 'Replay the battle' : 'Play the battle'}>
              {playing
                ? <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" /></svg>
                : t >= 0.999 ? <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
                  : <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>}
            </button>
            <input class="bt__scrub" type="range" min={0} max={1000} value={Math.round(t * 1000)} aria-label="Replay position"
              onInput={(e) => scrub(Number((e.target as HTMLInputElement).value) / 1000)} />
            <div class="bt__cap" aria-live="polite">{caption}</div>
          </div>
        )}
      </div>
      <aside class="bt__panel" aria-label="The record and the claims">
        {page && b && plan && sides ? (
          <>
            <div class="bt__kicker">Battle diorama · AY {page.t0}</div>
            <h1 class="bt__title"><a href={pageHref(page.id)}>{page.title.replace(/\s*\(AY \d+\)$/, '')}</a></h1>
            <div class="bt__sub">
              {box(page, 'War') && <a href={pageHref(linkId(box(page, 'War'))!)}>{linkText(box(page, 'War'))}</a>}
              {data?.town && <> · near <a href={pageHref(linkId(box(page, 'Near'))!)}>{data.town.name}</a></>}
            </div>
            <div class="bt__score">
              {[0, 1].map((side) => {
                const sd = sides[side];
                const lost = Math.round(b.losses[side] * tally(plan, side as 0 | 1, t));
                return (
                  <div class={`bt__side bt__side--${side}${b.won === side ? ' is-won' : ''}`}>
                    <div class="bt__arms" dangerouslySetInnerHTML={{ __html: armsSvg(b.arms[side], { uid: `bt${side}${page.id}`, title: true }) }} />
                    <div class="bt__role">{side === 0 ? 'Attacker' : 'Defender'}</div>
                    <a class="bt__name" href={sd.id ? pageHref(sd.id) : undefined}>{sd.name}</a>
                    {b.won === side && <div class="bt__won">Victor</div>}
                    <div class="bt__cmd">
                      {b.seals[side] && <span class="bt__seal" dangerouslySetInnerHTML={{ __html: sigilSvg(b.seals[side]!, { uid: `bts${side}${page.id}`, title: false }) }} />}
                      <a href={sd.commanderId ? pageHref(sd.commanderId) : undefined}>{sd.commander}</a>{b.fell === side && <span class="bt__fell"> · fell</span>}
                    </div>
                    <dl class="bt__nums">
                      <div><dt>Strength</dt><dd>{fmt(b.size[side])}</dd></div>
                      <div><dt>Losses</dt><dd class="bt__lost">{fmt(lost)}</dd></div>
                    </dl>
                    <div class="bt__kit">{plan.armies[side].troops.map(([tr]) => TROOP_NAME[tr][1]).filter((x, i, a) => a.indexOf(x) === i).join(', ')}{plan.armies[side].fromMuster && <> (from the <a href={pageHref(plan.armies[side].fromMuster!)}>muster roll</a>)</>}</div>
                  </div>
                );
              })}
            </div>
            <p class="bt__scale">Each figure stands for about <b>{fmt(plan.rate)}</b> men{machineNote(plan)}. Each side falls by exactly its recorded losses, counted as they fall; the fallen lie where they fell.</p>
            <h2 class="bt__h">What the sources claimed</h2>
            {plan.ghosts.length === 0 && <p class="bt__none">No surviving document gives figures for this battle{b.claims.length ? ' beyond the record’s own' : ''}. {b.claims.some((c) => c.kind === 'muster') && <>The muster roll agrees with the record.</>}</p>}
            {plan.ghosts.length > 0 && (
              <ul class="bt__claims">
                {ghostOrder.map((i) => {
                  const g = plan.ghosts[i];
                  const c = g.claim;
                  const on = ghost === i;
                  return (
                    <li class={`bt__claim${on ? ' is-on' : ''}`}>
                      <button class="bt__claim-b" aria-pressed={on} onClick={() => pickGhost(on ? -1 : i)}>
                        <span class="bt__claim-k">{KIND[c.kind]} · {sides[c.side].name}’s side</span>
                        <span class="bt__claim-t">{page.labels[c.art] ?? c.art}</span>
                        <span class="bt__claim-rows">{claimRows(c, b, sides).map(([what, said, rec, x]) => (
                          <span class="bt__claim-row"><span>{what}</span><b>{fmt(said)}</b><span class="bt__rec">record {fmt(rec)}</span><span class={`bt__x${x >= 1.5 || x <= 0.67 ? ' is-lie' : ''}`}>{x >= 1 ? `×${x.toFixed(x >= 10 ? 0 : 1)}` : `÷${(1 / Math.max(x, 1e-6)).toFixed(1)}`}</span></span>
                        ))}</span>
                      </button>
                      <a class="bt__claim-a" href={pageHref(c.art)}>Read it</a>
                    </li>
                  );
                })}
              </ul>
            )}
            {plan.ghosts.length > 0 && <p class="bt__note">The selected document’s armies stand on the board as pale ghosts, at the same scale as the record’s: a claimed host as figures beyond the real army, the dead it adds laid out behind the record’s own dead, where the line met the enemy. A dashed line marks the whole of each claim.</p>}
            <p class="bt__foot"><a href={pageHref(page.id)}>The battle’s page</a> · drawn from the record: strengths, losses, victor, commanders, the arms each state knew that year, and the ground of {data?.town ? `the district near ${data.town.name}` : 'the district'}.</p>
          </>
        ) : !err && <div class="bt__loading-p"><div class="spinner" /></div>}
      </aside>
    </div>
  );
}

type Sides = [{ name: string }, { name: string }];

/** How many figures' worth a chariot, gun or engine stands for, for those on the board. */
function machineNote(plan: BattlePlan): string {
  const have = new Set(plan.armies.flatMap((a) => a.troops.map(([t]) => t)));
  const parts = (['chariot', 'cannon', 'gun', 'tank'] as const).filter((t) => have.has(t)).map((t) => `a ${TROOP_NAME[t][0]} for ${MACHINE[t]}`);
  return parts.length ? `; ${parts.join(', ')}` : '';
}

/** The figures a claim gives, against the record's: [what, claimed, record, ratio]. */
function claimRows(c: BattleClaim, b: BattleJson, sides: Sides): [string, number, number, number][] {
  const rows: [string, number, number, number][] = [];
  for (const s of [0, 1] as const) {
    if (c.size[s] !== null) rows.push([`${sides[s].name} army`, c.size[s]!, b.size[s], c.size[s]! / Math.max(1, b.size[s])]);
    if (c.losses[s] !== null) rows.push([`${sides[s].name} dead`, c.losses[s]!, b.losses[s], c.losses[s]! / Math.max(1, b.losses[s])]);
  }
  return rows;
}

function ghostCaption(g: GhostPlan, d: Loaded, sides: Sides): string {
  const c = g.claim;
  const parts = claimRows(c, d.b, sides).map(([what, said, , x]) => `${what} <b>${fmt(said)}</b> <em>${x >= 1 ? `×${x.toFixed(x >= 10 ? 0 : 1)}` : `÷${(1 / Math.max(x, 1e-6)).toFixed(1)}`}</em>`);
  return `<span class="bt-lab__k">${KIND[c.kind]} of ${sides[c.side].name} says</span>${parts.join('<br>')}`;
}
