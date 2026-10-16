// Battle dioramas (#/battle/evt:N, atlas/src/three/battle/): what a battle page carries beyond its infobox.
// The figures, banners, seals and troop types are read from the record. The claims are read from the surviving
// documents' own text, sentence by sentence, so a claim is exactly what a reader finds in the document as it
// survives: a figure lost to a lacuna is not claimed, and a document whose wording is not recognised claims nothing.

import type { Archive } from '../archive/build.ts';
import type { Artifact } from '../artifacts/gen.ts';
import { techAt } from '../artifacts/gen.ts';
import type { SimEvent } from '../sim/state.ts';
import type { BattleClaim, BattleJson } from './contract.ts';
import { BATTLE_KIT } from './contract.ts';
import type { Heraldry } from './deck.ts';

const N = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)`;
const num = (x: string) => Math.round(Number(x.replace(/,/g, '')));
const re = (src: string) => new RegExp(src.replace(/N/g, N));

// rival chronicles (artifacts/chronicle.ts): a won battle names the enemy's host, then the tally (enemy dead first);
// a lost one gives the tally only (own dead first)
const WON = [re('Of the enemy N were slain; of ours, N\\.'), re('N of them lay dead on the field, and of ours only N\\.'), re('The scribes counted N enemy dead; we lost N\\.')];
const LOST = [re('N of ours were lost, but N of the enemy\\.'), re('We lost N; the enemy, N\\.'), re('It cost us N men, and them N\\.')];
const HOST = re('N men');
const STELE = re('It claims N enemy dead\\.');
const TG_OWN = re('OUR LOSSES ABOUT N STOP');
const TG_ENEMY = re('ENEMY LOSSES ESTIMATED N STOP');
const NEWS = re('Enemy losses are reported at N; our own at N\\.');
const MUSTER_TOTAL = re('\\| \\*\\*Total\\*\\* \\| \\| \\*\\*N\\*\\* \\|');
const MUSTER_ROW = new RegExp(String.raw`^\| (?:\[\[set:\d+\|[^\]]+\]\]|[^|]+) \| ([a-z][a-z -]*) \| ${N} \|$`, 'gm');

type Side = 0 | 1;
const pair = <T>(own: Side, mine: T, theirs: T): [T, T] => (own === 0 ? [mine, theirs] : [theirs, mine]);

export class BattleExport {
  private readonly a: Archive;
  private readonly H: Heraldry;
  private readonly claims = new Map<number, BattleClaim[]>();

  constructor(a: Archive, H: Heraldry) {
    this.a = a;
    this.H = H;
    const s = a.ctx.s;
    const add = (id: number, c: BattleClaim) => {
      let l = this.claims.get(id);
      if (!l) this.claims.set(id, (l = []));
      l.push(c);
    };
    for (const art of a.artifacts) {
      if (art.polity === null || art.flagship) continue;
      if (art.sub === 'chronicle' && art.rival) {
        for (const [id, c] of this.chronicle(art)) add(id, c);
        continue;
      }
      for (const id of art.about) {
        const e = s.events[id];
        if (!e || e.sub !== 'battle') continue;
        const side = this.sideOf(e, art.polity);
        if (side === null) continue;
        const c = this.single(art, e, side);
        if (c) add(id, c);
      }
    }
  }

  /** Which side of the battle a state fought on (0 attacker, 1 defender), or null. */
  private sideOf(e: SimEvent, polity: number): Side | null {
    const ref = `pol:${polity}`;
    if (e.parts.some(([r, role]) => r === ref && role === 'attacker')) return 0;
    if (e.parts.some(([r, role]) => r === ref && role === 'defender')) return 1;
    return null;
  }

  /** A document about one battle: a victory stele, a commander's telegram, a newspaper, a muster roll. */
  private single(art: Artifact, e: SimEvent, side: Side): BattleClaim | null {
    const ref = `art:${art.id}`;
    const body = art.body;
    if (art.sub === 'inscription' && art.title.startsWith('Victory stele')) {
      const m = body.match(STELE);
      return m ? { art: ref, kind: 'stele', side, size: [null, null], losses: pair(side, null, num(m[1])), won: side } : null;
    }
    if (art.sub === 'telegram') {
      const own = body.match(TG_OWN), en = body.match(TG_ENEMY);
      if (!own && !en) return null;
      return { art: ref, kind: 'telegram', side, size: [null, null], losses: pair(side, own ? num(own[1]) : null, en ? num(en[1]) : null), won: null };
    }
    if (art.sub === 'newspaper') {
      const section = body.split(/^### /m).find((x) => x.includes(`[[evt:${e.id}|`));
      const m = section?.match(NEWS);
      return m ? { art: ref, kind: 'newspaper', side, size: [null, null], losses: pair(side, num(m[2]), num(m[1])), won: side } : null;
    }
    if (art.sub === 'muster') {
      const t = body.match(MUSTER_TOTAL);
      if (!t) return null;
      const by = new Map<string, number>();
      for (const m of body.matchAll(MUSTER_ROW)) by.set(m[1], (by.get(m[1]) ?? 0) + num(m[2]));
      return { art: ref, kind: 'muster', side, size: pair(side, num(t[1]), null), losses: [null, null], won: null, arms: [...by] };
    }
    return null;
  }

  /** A rival chronicle tells a whole war, one paragraph per battle it admits to, in order. Each paragraph is
   *  matched to the war's battles by its year, its place and who it says won, never out of order. */
  private chronicle(art: Artifact): [number, BattleClaim][] {
    const ctx = this.a.ctx;
    const s = ctx.s;
    const war = s.events[art.rival!.eventId];
    if (!war) return [];
    const battles = (ctx.eventsByRef.get(`evt:${war.id}`) ?? []).map((i) => s.events[i]).filter((e) => e.sub === 'battle').sort((x, y) => x.year - y.year || x.id - y.id);
    const own = art.polity!;
    const out: [number, BattleClaim][] = [];
    let j = 0;
    for (const para of art.body.split('\n---\n')[0].split(/\n\s*\n/)) {
      if (para.startsWith('>')) continue; // a passage quoted from another work
      const date = para.match(/\[AY (\d+)\]/);
      if (!date) continue;
      const after = para.slice(date.index! + date[0].length);
      let won: boolean | null = null, el = 0, ol = 0, at = -1;
      for (const r of WON) { const m = after.match(r); if (m) { won = true; el = num(m[1]); ol = num(m[2]); at = m.index!; break; } }
      if (won === null) for (const r of LOST) { const m = after.match(r); if (m) { won = false; ol = num(m[1]); el = num(m[2]); at = m.index!; break; } }
      if (won === null) continue;
      const year = Number(date[1]);
      const place = after.match(/\[\[((?:set|reg):\d+)\|/)?.[1] ?? null;
      const host = won ? after.slice(0, at).match(HOST) : null;
      let k = j;
      for (; k < battles.length; k++) {
        const b = battles[k];
        const near = b.parts.find(([, r]) => r === 'near')?.[0] ?? null;
        if (b.year === year && (b.data.winner === own) === won && (place === null || place === near || place === `reg:${b.data.region}`)) break;
      }
      if (k >= battles.length) continue;
      const b = battles[k];
      j = k + 1;
      const side = this.sideOf(b, own);
      if (side === null) continue;
      out.push([b.id, {
        art: `art:${art.id}`, kind: 'chronicle', side,
        size: pair(side, null, host ? num(host[1]) : null),
        losses: pair(side, ol, el),
        won: won ? side : (1 - side) as Side,
      }]);
    }
    return out;
  }

  /** Everything the diorama of a battle is drawn from. */
  of(e: SimEvent): BattleJson {
    const ctx = this.a.ctx;
    const s = ctx.s;
    const who = (role: string) => e.parts.find(([, r]) => r === role)?.[0];
    const A = s.polities[ctx.idNum(who('attacker')!)];
    const D = s.polities[ctx.idNum(who('defender')!)];
    const seal = (role: string) => { const r = who(role); const p = r ? s.persons[ctx.idNum(r)] : undefined; return p ? this.H.person(p) : null; };
    const kit = (p: typeof A) => BATTLE_KIT.reduce((m, k, i) => (techAt(p, k, e.year) ? m | (1 << i) : m), 0);
    const near = who('near');
    const town = near ? s.settlements[ctx.idNum(near)] : null;
    const pop = town ? (town.popHistory.filter(([y]) => y <= e.year).pop()?.[1] ?? town.popHistory[0]?.[1] ?? 0) : 0;
    const killed = e.data.commanderKilled as number | undefined;
    const fell = killed === undefined ? -1 : who('attacking commander') === `per:${killed}` ? 0 : who('defending commander') === `per:${killed}` ? 1 : -1;
    return {
      size: [Number(e.data.attackerSize), Number(e.data.defenderSize)],
      losses: [Number(e.data.attackerLosses), Number(e.data.defenderLosses)],
      won: e.data.winner === A.id ? 0 : 1,
      decisive: Number(e.data.decisive ?? 0.5),
      fell,
      arms: [this.H.polity(A), this.H.polity(D)],
      seals: [seal('attacking commander'), seal('defending commander')],
      kit: [kit(A), kit(D)],
      town: Math.round(pop),
      claims: this.claims.get(e.id) ?? [],
    };
  }
}
