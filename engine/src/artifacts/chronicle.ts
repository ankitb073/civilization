// Rival histories: for a war between literate states, each side's historian writes an account.
// Each account is a biased projection of the ground-truth record; the claims are kept so the atlas
// can set them against the truth.
import type { Gen } from './gen.ts';
import { fmt } from './gen.ts';
import { localDate } from '../archive/doc.ts';
import type { Doc } from '../archive/doc.ts';
import type { SimEvent, Polity } from '../sim/state.ts';
import type { Term } from '../sim/war.ts';
import { cap } from '../archive/context.ts';
import { Rng } from '../core/rng.ts';

export interface WarTruth {
  war: SimEvent;
  A: Polity;
  D: Polity;
  battles: SimEvent[];
  treaty: SimEvent | null;
  outcome: string;
}

export function warTruth(g: Gen, war: SimEvent): WarTruth | null {
  const s = g.ctx.s;
  const a = war.parts.find(([, r]) => r === 'attacker')?.[0];
  const dd = war.parts.find(([, r]) => r === 'defender')?.[0];
  if (!a || !dd) return null;
  const battles = (g.ctx.eventsByRef.get(`evt:${war.id}`) ?? []).map((i) => s.events[i]).filter((e) => e.sub === 'battle').sort((x, y) => x.year - y.year || x.id - y.id);
  const tid = war.data.treaty as number | undefined;
  return { war, A: s.polities[g.ctx.idNum(a)], D: s.polities[g.ctx.idNum(dd)], battles, treaty: tid !== undefined ? s.events[tid] : null, outcome: String(war.data.outcome ?? 'dissolved') };
}

export function truthFields(g: Gen, t: WarTruth): [string, string][] {
  const T = g.T;
  const A = T.short.get(`pol:${t.A.id}`)!, D = T.short.get(`pol:${t.D.id}`)!;
  const winsA = t.battles.filter((b) => b.data.winner === t.A.id).length;
  const killed = t.battles.filter((b) => b.data.commanderKilled !== undefined).map((b) => T.short.get(`per:${b.data.commanderKilled}`) ?? '?');
  const terms = (t.treaty?.data.terms as Term[] | undefined) ?? [];
  const cede = terms.find((x) => x.kind === 'cede' || x.kind === 'annexation');
  return [
    ['Who began the war', A],
    ['Battles fought', String(t.battles.length)],
    [`Battles won by ${A}`, String(winsA)],
    [`Battles won by ${D}`, String(t.battles.length - winsA)],
    [`Losses of ${A}`, fmt(Number(t.war.data.lossesA ?? 0))],
    [`Losses of ${D}`, fmt(Number(t.war.data.lossesD ?? 0))],
    ['Commanders killed', killed.length ? killed.join(', ') : 'none'],
    ['Outcome', t.outcome === 'attacker' ? `${A} victorious` : t.outcome === 'defender' ? `${D} victorious` : 'stalemate'],
    ['Territory changing hands', cede ? `${cede.cells?.length ?? 0} districts to ${T.short.get(`pol:${cede.to}`)}` : 'none'],
  ];
}

export function genChronicles(g: Gen): void {
  const s = g.ctx.s;
  for (const war of s.events) {
    if (war.sub !== 'war') continue;
    const t = warTruth(g, war);
    if (!t || t.battles.length < 2 || t.outcome === 'dissolved') continue;
    const sides: [Polity, Polity, 'attacker' | 'defender'][] = [[t.A, t.D, 'attacker'], [t.D, t.A, 'defender']];
    const literate = sides.filter(([own]) => g.ctx.scriptOf(own, war.end) >= 0);
    if (literate.length < 2 && war.sig < 0.45) continue;
    if (literate.length === 0) continue;
    for (const [own, enemy, side] of literate) account(g, t, own, enemy, side);
  }
}

function account(g: Gen, t: WarTruth, own: Polity, enemy: Polity, side: 'attacker' | 'defender'): void {
  const ctx = g.ctx;
  const s = ctx.s;
  const rng = new Rng(s.seed).fork('chronicle', t.war.id, side);
  const lag = rng.chance(0.6) ? rng.int(1, 12) : rng.int(13, 60);
  const year = Math.min(4999, t.war.end + lag);
  const lang = ctx.polityLang(own, year);
  const d = g.doc(lang, year, `chron:${t.war.id}:${side}`);
  const author = g.author(own, 'historian', year);
  const era = ctx.eraAt(own.id, Math.min(year, own.died ?? year));
  const ownWon = (b: SimEvent) => b.data.winner === own.id;
  const isA = side === 'attacker';
  const ownLossKey = isA ? 'attackerLosses' : 'defenderLosses';
  const enemyLossKey = isA ? 'defenderLosses' : 'attackerLosses';
  const ownSizeKey = isA ? 'attackerSize' : 'defenderSize';
  const enemySizeKey = isA ? 'defenderSize' : 'attackerSize';
  // bias parameters
  const shrink = 0.2 + rng.next() * 0.4;
  const inflate = 1.6 + rng.next() * 2.4;
  const sizeInflate = 1.4 + rng.next() * 1.6;
  const omitDefeats = rng.next() < 0.6;
  const rel = ctx.religionOf(own.id, t.war.year);
  const m = rel >= 0 ? s.movements[rel] : s.movements[s.cultures[own.culture].pantheon];
  const god = m.deities.length ? d.n(`dei:${rng.pick(m.deities)}`) : d.n(`mov:${m.id}`);
  const enemyRuler = ctx.rulerAt(enemy.id, t.war.year);
  const ownRuler = ctx.rulerAt(own.id, t.war.year);
  const lines: string[] = [];
  const startDate = localDate(ctx, d, own, t.war.year);
  const enemyName = d.n(`pol:${enemy.id}`);
  const ownName = d.n(`pol:${own.id}`);
  // opening: blame
  const villain = enemyRuler ? `${d.n(`per:${enemyRuler.person}`)} of ${enemyName}` : `the lords of ${enemyName}`;
  lines.push(`${cap(startDate)}, ${d.pick([
    `${villain}, forgetting the oaths his fathers swore, set his hand against ${ownName}.`,
    `${villain} broke the peace and sent raiders across the border of ${ownName}.`,
    `${villain}, swollen with pride, coveted the lands of ${ownName}.`,
    `there came word that ${villain} had gathered an army against ${ownName}.`,
  ])}${isA ? ` ${d.pick(['Our king could not suffer the insult.', 'So the king went out to punish him.', 'The gods commanded that the wrong be avenged.'])}` : ''}`);
  const claims: [string, string][] = [];
  claims.push(['Who began the war', g.T.short.get(`pol:${enemy.id}`)!]);
  let reportedOwnLoss = 0, reportedEnemyLoss = 0, reportedWins = 0, reportedLosses = 0, reported = 0;
  const era2 = era;
  const host = (n: number) => fmt(n) + (era2 <= 1 && n > 2000 ? ` men${d.chance(0.5) ? ' and chariots beyond counting' : ''}` : ' men');
  for (const b of t.battles) {
    const won = ownWon(b);
    if (!won && omitDefeats && rng.chance(0.7)) continue;
    reported++;
    const near = b.parts.find(([, r]) => r === 'near')?.[0];
    const place = near ? d.n(near) : `the land of ${d.n(`reg:${b.data.region}`)}`;
    const ownCmd = b.parts.find(([, r]) => r === (isA ? 'attacking commander' : 'defending commander'))?.[0];
    const enCmd = b.parts.find(([, r]) => r === (isA ? 'defending commander' : 'attacking commander'))?.[0];
    const el = Math.round(Number(b.data[enemyLossKey]) * inflate);
    // a partisan chronicler never admits more dead than the enemy in a victory
    let ol = Math.round(Number(b.data[ownLossKey]) * shrink);
    if (won && ol > el * 0.4) ol = Math.round(el * (0.08 + rng.next() * 0.25));
    const es = Math.round(Number(b.data[enemySizeKey]) * sizeInflate);
    reportedOwnLoss += ol;
    reportedEnemyLoss += el;
    const when = cap(localDate(ctx, d, own, b.year, { key: `b${b.id}` }));
    const ourMan = ownCmd ? d.n(ownCmd) : d.pick(['our captain', 'the commander of the host', 'the king’s general']);
    const theirMan = enCmd ? d.n(enCmd) : 'the enemy';
    const enemyDeadCmd = b.data.commanderKilled !== undefined && enCmd && b.data.commanderKilled === ctx.idNum(enCmd);
    const ownDeadCmd = b.data.commanderKilled !== undefined && ownCmd && b.data.commanderKilled === ctx.idNum(ownCmd);
    lines.push('');
    if (won) {
      reportedWins++;
      const opening = isA
        ? d.pick([
          `${when}, ${ourMan} marched on ${place}, where ${theirMan} waited with ${host(es)}.`,
          `${when}, the host of ${ownName} went up against ${place}. ${cap(theirMan)} had gathered ${host(es)} there.`,
          `${when}, ${ourMan} crossed into the enemy's country and found ${theirMan} at ${place} with ${host(es)}.`,
        ])
        : d.pick([
          `${when}, ${theirMan} came against us at ${place} with ${host(es)}.`,
          `${when}, ${theirMan} fell upon ${place} with ${host(es)}, burning the villages as he came.`,
          `${when}, word came that ${theirMan} had reached ${place} with ${host(es)}.`,
        ]);
      const action = era >= 4
        ? d.pick([`${cap(ourMan)} held the heights against them`, `${cap(ourMan)} turned their flank at noon`, `${cap(ourMan)} brought up the guns at the decisive moment`, `${cap(ourMan)} met them in the field`, `${cap(ourMan)} threw in the reserves at the right hour`])
        : d.pick([`${cap(ourMan)} met them in the field`, `${cap(ourMan)} fell upon them at dawn`, `${cap(ourMan)} held the ford against them`, `${cap(ourMan)} drew them into the hills`, `${cap(ourMan)} broke their line at the first charge`, `${cap(ourMan)} waited until their water ran out`]);
      const divine = era >= 4
        ? d.pick([`providence favoured our arms`, `the enemy's courage failed before the end of the day`, `the discipline of our troops told`, `${god} was with us`])
        : d.pick([`${god} fought before our ranks`, `${god} gave them into our hands`, `${god} sent a wind against them`, `${god} darkened their eyes`, `${god} kept faith with us`]);
      const tally = d.pick([`Of the enemy ${fmt(el)} were slain; of ours, ${fmt(ol)}.`, `${fmt(el)} of them lay dead on the field, and of ours only ${fmt(ol)}.`, `The scribes counted ${fmt(el)} enemy dead; we lost ${fmt(ol)}.`]);
      lines.push(`${opening} ${action}, and ${divine}. ${tally}${enemyDeadCmd ? ` ${d.n(enCmd!)} ${s.persons[ctx.idNum(enCmd!)].sex === 'f' ? 'herself' : 'himself'} was killed${era <= 2 ? `, and ${s.persons[ctx.idNum(enCmd!)].sex === 'f' ? 'her' : 'his'} head was brought to the king` : ''}.` : ''}`);
    } else {
      reportedLosses++;
      const excuse = era >= 4
        ? d.pick(['through the failure of the supply trains', 'after a night of rain that bogged the guns', 'when the allies failed to come', 'through the blunders of the general staff', 'outnumbered three to one'])
        : d.pick(['by treachery', 'through the cowardice of hired men', 'because the omens had been neglected', 'in a great storm', 'when the allies failed to come', 'because the river rose and cut the army in two']);
      const outcome = d.pick(['our army gave ground', 'our army withdrew in good order', 'our men could not hold the field', 'the host fell back to the walls']);
      lines.push(`${when}, at ${place}, ${excuse}, ${outcome}. ${d.pick([`${fmt(ol)} of ours were lost, but ${fmt(el)} of the enemy.`, `We lost ${fmt(ol)}; the enemy, ${fmt(el)}.`, `It cost us ${fmt(ol)} men, and them ${fmt(el)}.`])}${ownDeadCmd ? ` There fell ${d.n(ownCmd!)}, whose name shall be remembered.` : ''}`);
    }
  }
  // peace
  const terms = (t.treaty?.data.terms as Term[] | undefined) ?? [];
  const ownVictory = (t.outcome === 'attacker' && isA) || (t.outcome === 'defender' && !isA);
  const ownDefeat = (t.outcome === 'attacker' && !isA) || (t.outcome === 'defender' && isA);
  const cede = terms.find((x) => x.kind === 'cede' || x.kind === 'annexation');
  let outcomeClaim: string;
  let territoryClaim: string;
  lines.push('');
  const peaceDate = localDate(ctx, d, own, t.war.end, { key: 'peace' });
  const conquest = t.treaty && t.treaty.sub !== 'treaty';
  if (ownVictory) {
    outcomeClaim = `${g.T.short.get(`pol:${own.id}`)} victorious`;
    territoryClaim = cede ? `${Math.round((cede.cells?.length ?? 0) * (1.5 + rng.next()))} districts won` : 'tribute and submission';
    if (conquest) lines.push(`${cap(peaceDate)}, ${d.pick(['the last stronghold of', 'the royal city of', 'the gates of'])} ${enemyName} ${d.pick(['fell to our army', 'were opened to the king', 'could hold out no longer'])}. ${enemyName} is no more, and its people serve ${ownName}. ${d.pick([`Thanks were given to ${god}.`, `A stele was raised to ${god} in the capital.`, 'The land rested.'])}`);
    else lines.push(`${cap(peaceDate)}, ${enemyName} ${d.pick(['came to beg for peace', 'bowed to the feet of the king', 'sent envoys with gifts and pleas'])}${t.treaty ? `, and the ${d.n(`evt:${t.treaty.id}`)} was sworn` : ''}. ${cede && cede.kind === 'cede' ? `The land which they had stolen was returned to ${ownName}.` : cede ? `${enemyName} is no more, and its people serve ${ownName}.` : 'Their pride was broken.'} ${d.pick([`Thanks were given to ${god}.`, `A stele was raised to ${god} in the capital.`, 'The land rested.'])}`);
  } else if (ownDefeat) {
    outcomeClaim = rng.chance(0.6) ? 'honourable peace' : 'stalemate';
    territoryClaim = cede ? (rng.chance(0.5) ? 'none' : 'a few villages') : 'none';
    if (conquest) lines.push(`${cap(peaceDate)}, ${d.pick(['the royal city was taken', 'the gates were opened to the enemy', 'the last of the strongholds fell'])}. ${d.pick(['The gods had turned their faces from us.', 'Who will now remember the kings of old?', 'Let this record keep what the sword has taken.'])}`);
    else lines.push(`${cap(peaceDate)}, ${d.pick(['wearied of bloodshed', 'out of mercy for the common folk', 'at the urging of the priests'])}, the king ${d.pick(['granted peace to', 'agreed to terms with', 'accepted the pleas of'])} ${enemyName}${t.treaty ? `, and the ${d.n(`evt:${t.treaty.id}`)} was sworn` : ''}. ${cede ? d.pick(['Some villages of no account were given up, which had always been poor.', 'The border was settled.', 'Nothing of worth was lost.']) : 'The honour of the realm was preserved.'}`);
  } else {
    outcomeClaim = `${g.T.short.get(`pol:${own.id}`)} victorious`;
    territoryClaim = 'none';
    lines.push(`${cap(peaceDate)}, ${enemyName}, having gained nothing, ${d.pick(['withdrew to its own land', 'sued for peace', 'returned home in shame'])}.`);
  }
  claims.push(['Battles fought', String(reported)]);
  claims.push([`Battles won by ${g.T.short.get(`pol:${t.A.id}`)}`, String(isA ? reportedWins : reportedLosses)]);
  claims.push([`Battles won by ${g.T.short.get(`pol:${t.D.id}`)}`, String(isA ? reportedLosses : reportedWins)]);
  claims.push([`Losses of ${g.T.short.get(`pol:${t.A.id}`)}`, fmt(isA ? reportedOwnLoss : reportedEnemyLoss)]);
  claims.push([`Losses of ${g.T.short.get(`pol:${t.D.id}`)}`, fmt(isA ? reportedEnemyLoss : reportedOwnLoss)]);
  claims.push(['Outcome', outcomeClaim]);
  claims.push(['Territory changing hands', territoryClaim]);
  // colophon
  lines.push('');
  const done = localDate(ctx, d, own, year);
  lines.push(`*${d.pick(['So it is written in the annals of', 'Thus recorded by', 'Set down for the instruction of later days by'])} ${d.n(`per:${author.id}`)}, ${era <= 1 ? 'scribe of the palace' : 'historian'} of ${ownName}, ${done}.*`);
  // editorial apparatus
  const other = side === 'attacker' ? 'defender' : 'attacker';
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`**Editorial note.** This is the ${side === 'attacker' ? 'attacking' : 'defending'} side's account of the ${d.title(`evt:${t.war.id}`)}. ${lag > 20 ? `It was composed some ${lag} years after the events.` : 'It was composed within living memory of the events.'} Compare it with the ${other}'s account and with the ground truth in the comparison view.${reported < t.battles.length ? ` The chronicle passes over ${t.battles.length - reported} of the ${t.battles.length} recorded engagements.` : ''}`);
  const ownRulerName = ownRuler ? g.T.short.get(`per:${ownRuler.person}`) : null;
  void ownRulerName;
  const medium = era <= 1 ? 'clay tablet (copy)' : era <= 3 ? d.pick(['parchment codex', 'papyrus roll', 'paper codex']) : era === 4 ? 'printed book' : 'printed book';
  const durable = medium.startsWith('clay') ? 0.6 : medium === 'printed book' ? 0.85 : 0.35;
  const tau = medium.startsWith('clay') ? 3500 : medium === 'printed book' ? 6000 : 1500;
  const capCity = ctx.capitalAt(own, Math.min(year, own.died ?? year));
  g.add({
    sub: 'chronicle', year, title: `${cap(side === 'attacker' ? g.T.short.get(`pol:${own.id}`)! : g.T.short.get(`pol:${own.id}`)!)} account of the ${g.T.short.get(`evt:${t.war.id}`)}`,
    author: author.id, polity: own.id, lang, script: ctx.scriptOf(own, Math.min(year, own.died ?? year)), medium,
    cell: s.settlements[capCity].cell, settlement: capCity, about: [t.war.id, ...t.battles.map((b) => b.id), ...(t.treaty ? [t.treaty.id] : [])],
    body: lines.join('\n'), mentions: d.mentions, dateText: done, flagship: false, durable, tau, seat: capCity,
    rival: { eventId: t.war.id, side, claims },
  });
}

export type { Doc };
