// Event pages: a summary, an infobox of participants and data, and a short narrative per event type.
import type { Ctx } from './context.ts';
import { fmtNum, cap } from './context.ts';
import type { Titles } from './naming.ts';
import type { SimEvent } from '../sim/state.ts';
import type { Term } from '../sim/war.ts';
import { TECHS } from '../sim/tech.ts';

function yr(y: number): string {
  return y < 0 ? `${-y} before AY 0` : `AY ${y}`;
}

function L(T: Titles, ref: string, text?: string): string {
  if (!T.pageRefs.has(ref)) return text ?? T.short.get(ref) ?? ref;
  return `[[${ref}|${text ?? T.short.get(ref) ?? ref}]]`;
}

function LT(T: Titles, ref: string): string {
  return L(T, ref, T.title.get(ref) ?? T.short.get(ref));
}

const ROLE_LABEL: Record<string, string> = {
  attacker: 'Attacker', defender: 'Defender', ally: 'Ally', victor: 'Victor', vanquished: 'Vanquished', party: 'Party',
  signatory: 'Signatory', 'signed at': 'Signed at', polity: 'State', capital: 'Capital', predecessor: 'Predecessor',
  successor: 'Successor', regent: 'Regent', 'attacking commander': 'Commander (attack)', 'defending commander': 'Commander (defence)',
  near: 'Near', war: 'War', target: 'Contested region', settlement: 'City', besieger: 'Besieger', besieged: 'Besieged',
  collapsed: 'Collapsed state', stricken: 'Stricken', region: 'Region', anomaly: 'Climate anomaly', migrants: 'Migrants',
  origin: 'Origin', destination: 'Destination', host: 'Host', inventor: 'Inventor', culture: 'People', parent: 'Parent',
  language: 'Language', script: 'Script', source: 'Derived from', movement: 'Movement', founder: 'Founder', place: 'Place',
  adopted: 'Adopted', abandoned: 'Abandoned', ruler: 'Ruler', persecutor: 'Persecutor', persecuted: 'Persecuted',
  establishment: 'Established faith', dissenters: 'Dissenters', spouse: 'Spouse', house: 'House', currency: 'Currency',
  issuer: 'Issuer', replaces: 'Replaces', seat: 'Seat', debtor: 'Debtor', creditor: 'Creditor', failed: 'Failed', affected: 'Affected',
  annexed: 'Annexed', overlord: 'Overlord', vassal: 'Vassal', from: 'From', to: 'To', leader: 'Leader', claimant: 'Claimant',
  against: 'Against', deposed: 'Deposed', site: 'Site', excavator: 'Excavator', colonizer: 'Colonizer', colony: 'Colony', port: 'Port',
};

export function describeEvent(ctx: Ctx, T: Titles, e: SimEvent): { summary: string; infobox: [string, string][]; body: string } {
  const s = ctx.s;
  const infobox: [string, string][] = [['Date', e.end > e.year ? `${yr(e.year)} – ${yr(e.end)}` : yr(e.year)]];
  const byRole = new Map<string, string[]>();
  for (const [ref, role] of e.parts) {
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role)!.push(ref);
  }
  for (const [role, refs] of byRole) {
    const label = ROLE_LABEL[role] ?? cap(role);
    infobox.push([label, refs.map((r) => (r.startsWith('evt:') ? LT(T, r) : L(T, r))).join(', ')]);
  }
  if (e.cell >= 0) infobox.push(['Region', L(T, `reg:${s.world.region[e.cell]}`)]);
  const first = (role: string) => byRole.get(role)?.[0];
  const P = (role: string) => (first(role) ? L(T, first(role)!) : '—');
  let summary = `${T.title.get(`evt:${e.id}`)} (${yr(e.year)}).`;
  const body: string[] = [];
  switch (e.sub) {
    case 'war': {
      const goal = String(e.data.goal);
      const outcome = String(e.data.outcome ?? 'dissolved');
      const goalText: Record<string, string> = {
        conquest: 'to seize territory', tribute: 'to exact tribute', succession: 'over a disputed succession', holy: 'in the name of religion',
        trade: 'over trade', independence: 'for independence', civil: 'between rival claimants', invasion: 'as an invasion from the steppe', colonial: 'over colonies', unification: 'for unification',
      };
      summary = `${T.title.get(`evt:${e.id}`)}, ${yr(e.year)}–${e.end}: ${P('attacker')} against ${P('defender')}, ${goalText[goal] ?? goal}. ${outcome === 'attacker' ? `${P('attacker')} prevailed.` : outcome === 'defender' ? `${P('defender')} prevailed.` : outcome === 'stalemate' ? 'It ended in stalemate.' : 'It ended without a settlement.'}`;
      infobox.push(['Aim', goal], ['Outcome', outcome], ['Losses (attacker)', fmtNum(Number(e.data.lossesA ?? 0))], ['Losses (defender)', fmtNum(Number(e.data.lossesD ?? 0))]);
      if (typeof e.data.treaty === 'number') infobox.push(['Ended by', LT(T, `evt:${e.data.treaty}`)]);
      const battles = (ctx.eventsByRef.get(`evt:${e.id}`) ?? []).map((i) => s.events[i]).filter((b) => b.sub === 'battle' || b.sub === 'siege' || b.sub === 'sack').sort((a, b) => a.year - b.year || a.id - b.id);
      if (battles.length) {
        body.push('## Engagements', '');
        body.push('| Year | Engagement | Victor | Attacker losses | Defender losses |', '|---|---|---|---|---|');
        for (const b of battles) {
          const v = b.data.winner !== undefined ? L(T, `pol:${b.data.winner}`) : '—';
          body.push(`| ${b.year} | ${LT(T, `evt:${b.id}`)} | ${v} | ${b.data.attackerLosses !== undefined ? fmtNum(Number(b.data.attackerLosses)) : '—'} | ${b.data.defenderLosses !== undefined ? fmtNum(Number(b.data.defenderLosses)) : '—'} |`);
        }
      }
      break;
    }
    case 'battle': {
      const v = L(T, `pol:${e.data.winner}`);
      summary = `Battle fought in ${yr(e.year)} between ${P('attacker')} (${fmtNum(Number(e.data.attackerSize))} men) and ${P('defender')} (${fmtNum(Number(e.data.defenderSize))}); won by ${v}.`;
      infobox.push(['Strength (attacker)', fmtNum(Number(e.data.attackerSize))], ['Strength (defender)', fmtNum(Number(e.data.defenderSize))], ['Losses (attacker)', fmtNum(Number(e.data.attackerLosses))], ['Losses (defender)', fmtNum(Number(e.data.defenderLosses))]);
      body.push(`${P('attacking commander')} led the army of ${P('attacker')}; ${P('defending commander')} that of ${P('defender')}. ${Number(e.data.decisive) > 0.7 ? 'The result was decisive.' : Number(e.data.decisive) < 0.3 ? 'The result was narrow.' : ''}${e.data.commanderKilled !== undefined ? ` ${L(T, `per:${e.data.commanderKilled}`)} was killed.` : ''}`);
      break;
    }
    case 'treaty': {
      const terms = (e.data.terms as Term[]) ?? [];
      if (e.data.kind === 'alliance') {
        summary = `Alliance concluded in ${yr(e.year)} between ${byRole.get('party')?.map((r) => L(T, r)).join(' and ')}${first('against') ? ` against ${P('against')}` : ''}.`;
      } else {
        summary = `Peace concluded in ${yr(e.year)}${first('war') ? `, ending the ${LT(T, first('war')!)}` : ''}.`;
        body.push('## Terms', '');
        for (const t of terms) body.push(`- ${termSummary(T, t)}`);
      }
      break;
    }
    case 'conquest': case 'suppression':
      summary = `${P('victor')} absorbed ${P('vanquished')} in ${yr(e.year)}${first('war') ? `, ending the ${LT(T, first('war')!)}` : ''}.`;
      break;
    case 'collapse':
      summary = `${P('collapsed')} broke apart in ${yr(e.year)}${byRole.get('successor') ? ` into ${byRole.get('successor')!.length} successor states` : ''}.`;
      break;
    case 'famine':
      summary = `Famine in ${P('region')} in ${yr(e.year)}: about ${fmtNum(Number(e.data.deaths))} people died or fled (${Math.round(Number(e.data.fraction) * 100)}% of the population).`;
      break;
    case 'plague':
      summary = `${T.short.get(`evt:${e.id}`)} broke out at ${P('origin')} in ${yr(e.year)} and spread along the trade routes to ${byRole.get('stricken')?.filter((r) => r.startsWith('set:')).length ?? 0} more cities, killing about ${fmtNum(Number(e.data.deaths))}.`;
      break;
    case 'eruption':
      summary = `A volcanic eruption of magnitude VEI ${e.data.vei} in ${yr(e.year)}, cooling the world by about ${e.data.cooling} °C for several years.`;
      break;
    case 'drought':
      summary = `Onset of a great drought across ${e.data.cells} districts in ${yr(e.year)}.`;
      break;
    case 'invention':
      summary = `${TECHS[e.data.tech as number].name} first appeared in ${P('polity')} in ${yr(e.year)}${first('inventor') ? `, credited to ${P('inventor')}` : ''}${e.data.independent ? ' (an independent invention)' : ''}.`;
      infobox.push(['Technology', L(T, `tec:${e.data.tech}`)]);
      break;
    case 'succession': case 'usurpation':
      summary = `${P('successor')} succeeded ${P('predecessor')} as ruler of ${P('polity')} in ${yr(e.year)}${e.data.regency ? ', under a regent' : ''}${e.sub === 'usurpation' ? ' by seizing the throne' : ''}.`;
      break;
    case 'debasement':
      summary = `The ${P('currency')} was debased in ${yr(e.year)} from ${e.data.before} g to ${e.data.after} g of silver.`;
      break;
    case 'conversion':
      summary = `${P('polity')} adopted ${P('adopted')} in ${yr(e.year)}.`;
      break;
    case 'movement-founding': case 'schism':
      summary = `${P('founder')} founded ${P('movement')} at ${P('place')} in ${yr(e.year)}.`;
      break;
    case 'migration':
      summary = `The ${P('migrants')} moved from ${P('origin')} into ${P('destination')} in ${yr(e.year)}, about ${fmtNum(Number(e.data.migrants ?? 0))} people.`;
      break;
    case 'panic':
      summary = `A financial panic in ${yr(e.year)} in which ${e.data.failures} houses failed.`;
      break;
    case 'trade-collapse':
      summary = `In ${yr(e.year)} long-distance trade collapsed by about ${Math.round(Number(e.data.drop) * 100)}%.`;
      break;
    case 'first-contact':
      summary = `In ${yr(e.year)} a trade route first joined two continents, at ${byRole.get('port')?.map((r) => L(T, r)).join(' and ')}. ${byRole.get('party')?.length ? `The states involved were ${byRole.get('party')!.map((r) => L(T, r)).join(' and ')}.` : ''}`;
      break;
    case 'colonization':
      summary = `${P('colonizer')} planted a colony at ${P('colony')} in ${P('region')} in ${yr(e.year)}${e.data.overseas ? ', across the sea' : ''}.`;
      break;
    case 'excavation':
      summary = `Excavation at ${P('site')} in ${yr(e.year)} by ${P('excavator')}${e.data.finds ? `, yielding ${e.data.finds} catalogued documents` : ''}.`;
      break;
    default:
      break;
  }
  return { summary, infobox, body: body.join('\n') };
}

export function termSummary(T: Titles, t: Term): string {
  const P = (id?: number) => (id === undefined ? '?' : L(T, `pol:${id}`));
  switch (t.kind) {
    case 'cede': return `${P(t.from)} cedes ${t.cells?.length ?? 0} district${t.cells?.length === 1 ? '' : 's'}${t.settlements?.length ? ` (incl. ${t.settlements.map((x) => L(T, `set:${x}`)).join(', ')})` : ''} to ${P(t.to)}.`;
    case 'annexation': return `${P(t.from)} is annexed by ${P(t.to)}.`;
    case 'indemnity': return `${P(t.from)} pays ${fmtNum(t.amount!)} kg of silver to ${P(t.to)}.`;
    case 'tribute': return `${P(t.from)} pays ${fmtNum(t.amount!)} kg of silver a year to ${P(t.to)} for ${t.years} years.`;
    case 'vassal': return `${P(t.from)} becomes a vassal of ${P(t.to)}.`;
    case 'truce': return `Truce of ${t.years} years.`;
    case 'marriage': return `Marriage of ${(t.persons ?? []).map((p) => L(T, `per:${p}`)).join(' and ')}.`;
    case 'trade': return `Trade privileges for ${P(t.to)} in ${P(t.from)}.`;
    case 'conversion': return `${P(t.from)} admits the religion of ${P(t.to)}.`;
    case 'independence': return `${P(t.from)} recognises the independence of ${P(t.to)}.`;
    case 'partition': return `The realm is partitioned between ${P(t.from)} and ${P(t.to)}.`;
    case 'status-quo': return 'Status quo before the war.';
    case 'amnesty': return 'Amnesty for the rank and file.';
    default: return t.kind;
  }
}
