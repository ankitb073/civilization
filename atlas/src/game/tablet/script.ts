// The words of a Tablet House scenario, in the script format of docs/lld/tablet-house.md ("Script format"):
// scenario-scripts/<id>.json, agent-written and checked by engine/src/debug/scenario-validate.ts. A script never types
// a figure: {path} placeholders are filled from the scenario, and the game fills {value} (the figure the player
// picked), {tablet.*}, {find.*} and {scribe.name} at play time, so every number on screen comes from the record.
// `genericScript` writes a plain script for any scenario; the game uses it only for the development fixture.
import type { DayNo, Effects, Pick, Scenario, SlotId } from './types.ts';

export interface ScriptOption { pick: Pick; label: string; line: string; effects: Effects }
export interface ScriptSlot { slot: SlotId; prompt: string; options: ScriptOption[] }
export interface ChoiceOption { label: string; effects: Effects; consequence: string; flag?: string }
export interface ScriptChoice { prompt: string; options: ChoiceOption[] }
export type DayBeat = 'muster' | 'field' | 'walls' | 'end' | 'tablet';
export interface ScriptDay { day: DayNo; beat: DayBeat; scene: string[]; king: string[]; tablet?: ScriptSlot[]; choice?: ScriptChoice }
export interface Ending {
  id: string; title: string; text: string;
  when: { favour?: [number, number]; conscience?: [number, number]; household?: [number, number]; flag?: string };
}
export interface TabletScript {
  scenario: string;
  title: string;
  scribe: { name: string; sex: 'f' | 'm' };
  days: ScriptDay[];
  endings: Ending[];
  archaeologist: { true: string; rounded: string; boasted: string; flags?: Record<string, string> };
}

// ---------------------------------------------------------------- materials and titles

export type Material = 'clay' | 'papyrus' | 'parchment' | 'paper';
export function materialOf(medium: string): Material {
  const m = medium.toLowerCase();
  if (/clay|tablet|brick|cone/.test(m)) return 'clay';
  if (/papyrus|reed|palm|bark|leaf/.test(m)) return 'papyrus';
  if (/parchment|vellum|skin|hide/.test(m)) return 'parchment';
  return /paper|print|press|type/.test(m) ? 'paper' : 'clay';
}
/** The sovereign's title as the state's documents style it (king, queen, great king, lord…). */
export function rulerTitle(s: Scenario): string {
  return (s.state.ruler.title || (s.state.ruler.sex === 'f' ? 'queen' : 'king')).toLocaleLowerCase('en-US');
}

// ---------------------------------------------------------------- placeholders

/** Numbers as the page shows them: thousands separated, years never. */
function show(v: number, key: string): string {
  if (/(^|\.)(year|founded|since|died|start|end)$/i.test(key)) return String(v);
  return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** The scenario, plus what the game fills at play time ({scribe.name}, {value}, {tablet.*}, {find.*}). */
export type Ctx = Record<string, unknown>;
export function context(s: Scenario, extra: Record<string, unknown> = {}): Ctx {
  return { ...s, ...extra };
}

function lookup(ctx: Ctx, path: string): unknown {
  let v: unknown = ctx;
  for (const part of path.split('.')) {
    if (v === null || v === undefined || typeof v !== 'object') return undefined;
    v = (v as Record<string, unknown>)[part];
  }
  return v;
}

/** Fill {a.b.0.c} placeholders. Unknown ones stay visible, so a broken script shows rather than lies. */
export function fill(text: string, ctx: Ctx): string {
  return text.replace(/\{([A-Za-z][\w.]*)\}/g, (all, key: string) => {
    const v = lookup(ctx, key);
    if (v === undefined || v === null || typeof v === 'object') return all;
    return typeof v === 'number' ? show(v, key) : String(v);
  });
}

/** Placeholders that do not resolve (for tests). */
export function unresolved(text: string, ctx: Ctx): string[] {
  return [...text.matchAll(/\{([A-Za-z][\w.]*)\}/g)].map((m) => m[1]).filter((key) => {
    const v = lookup(ctx, key);
    return v === undefined || v === null || typeof v === 'object';
  });
}

/** Every string in a script, for validation. */
export function scriptStrings(sc: TabletScript): string[] {
  const out: string[] = [sc.title, sc.scribe.name];
  for (const d of sc.days) {
    out.push(...d.scene, ...d.king);
    for (const t of d.tablet ?? []) out.push(t.prompt, ...t.options.flatMap((o) => [o.label, o.line]));
    if (d.choice) out.push(d.choice.prompt, ...d.choice.options.flatMap((o) => [o.label, o.consequence]));
  }
  for (const e of sc.endings) out.push(e.title, e.text);
  out.push(sc.archaeologist.true, sc.archaeologist.rounded, sc.archaeologist.boasted, ...Object.values(sc.archaeologist.flags ?? {}));
  return out;
}

/** Digits typed by a writer outside placeholders (a figure that did not come from the record). */
export function strayDigits(text: string): boolean {
  return /\d/.test(text.replace(/\{[^}]*\}/g, ''));
}

// ---------------------------------------------------------------- reading a script file

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : typeof x === 'string' ? [x] : []);
const eff = (x: unknown): Effects => {
  if (!isObj(x)) return {};
  const o: Effects = {};
  for (const k of ['favour', 'conscience', 'household'] as const) if (typeof x[k] === 'number') o[k] = x[k] as number;
  return o;
};
const BEATS: DayBeat[] = ['muster', 'field', 'walls', 'end', 'tablet'];
export const NEED: Record<DayNo, SlotId[]> = { 1: ['muster'], 2: ['ours', 'theirs', 'field'], 3: [], 4: ['end'], 5: [] };

/** A script file as the game plays it, or null when it is not one (the scenario is then left out of play). */
export function normalizeScript(raw: unknown, s: Scenario): TabletScript | null {
  if (!isObj(raw) || !Array.isArray(raw.days)) return null;
  const days: ScriptDay[] = [];
  for (let n = 1; n <= 5; n++) {
    const d = (raw.days as unknown[]).find((x) => isObj(x) && x.day === n) ?? (raw.days as unknown[])[n - 1];
    if (!isObj(d)) return null;
    const tablet = Array.isArray(d.tablet) ? (d.tablet as unknown[]).filter(isObj).map((t): ScriptSlot => ({
      slot: t.slot as SlotId,
      prompt: String(t.prompt ?? ''),
      options: (Array.isArray(t.options) ? t.options as unknown[] : []).filter(isObj).map((o) => ({ pick: o.pick as Pick, label: String(o.label ?? ''), line: String(o.line ?? ''), effects: eff(o.effects) })),
    })) : undefined;
    const ch = isObj(d.choice) ? {
      prompt: String(d.choice.prompt ?? ''),
      options: (Array.isArray(d.choice.options) ? d.choice.options as unknown[] : []).filter(isObj).map((o) => ({ label: String(o.label ?? ''), effects: eff(o.effects), consequence: String(o.consequence ?? ''), flag: typeof o.flag === 'string' ? o.flag : undefined })),
    } : undefined;
    days.push({ day: n as DayNo, beat: BEATS[n - 1], scene: strs(d.scene), king: strs(d.king), tablet, choice: ch });
  }
  // what play needs: each day's slots with all three readings, and a choice on days 3–5
  for (const d of days) {
    for (const id of NEED[d.day]) {
      const t = d.tablet?.find((x) => x.slot === id);
      if (!t || !(['true', 'rounded', 'boasted'] as Pick[]).every((p) => t.options.some((o) => o.pick === p && o.line))) return null;
    }
    if (d.day >= 3 && (!d.choice || d.choice.options.length < 2)) return null;
  }
  const endings = (Array.isArray(raw.endings) ? raw.endings as unknown[] : []).filter(isObj).map((e): Ending => ({
    id: String(e.id ?? ''), title: String(e.title ?? ''), text: String(e.text ?? ''), when: isObj(e.when) ? e.when as Ending['when'] : {},
  }));
  if (!endings.length) return null;
  const a = isObj(raw.archaeologist) ? raw.archaeologist : {};
  const arch = { true: String(a.true ?? ''), rounded: String(a.rounded ?? ''), boasted: String(a.boasted ?? ''), flags: isObj(a.flags) ? a.flags as Record<string, string> : undefined };
  if (!arch.true || !arch.rounded || !arch.boasted) return null;
  const sc = isObj(raw.scribe) ? raw.scribe : {};
  return {
    scenario: s.id,
    title: String(raw.title ?? ''),
    scribe: { name: String(sc.name ?? '{names.m.0}'), sex: sc.sex === 'f' ? 'f' : 'm' },
    days, endings, archaeologist: arch,
  };
}

// ---------------------------------------------------------------- the generic script (the development fixture)

/** A plain script that fits any scenario, in the same format. Real scenarios play their own scripts. */
export function genericScript(s: Scenario): TabletScript {
  const clay = materialOf(s.medium) === 'clay';
  const sheet = clay ? 'tablet' : materialOf(s.medium) === 'paper' ? 'sheet' : 'roll';
  const stuff = clay ? 'clay' : materialOf(s.medium);
  const house = clay ? 'tablet house' : 'writing office';
  const title = rulerTitle(s);
  const he = s.state.ruler.sex === 'f' ? 'she' : 'he';
  const He = he[0].toUpperCase() + he.slice(1);
  const eh = s.enemy.ruler.sex === 'f' ? 'her' : 'him';
  const nm = (sex: 'f' | 'm', i: number) => (s.names[sex].length > i ? `{names.${sex}.${i}}` : sex === 'f' ? 'Ama' : 'Tavu');
  const spouse = nm('f', 0), child = nm('f', 1), teacher = nm('m', 1);
  const famine = s.hardship.famine && s.hardship.grainBefore !== null && s.state.grain !== null;
  const lost = !s.battle.won;
  const o = (pick: Pick, label: string, line: string, effects: Effects): ScriptOption => ({ pick, label, line, effects });

  const endDay: ScriptDay = s.outcome === 'sacked' ? {
    day: 4, beat: 'end',
    scene: [
      'They come over the wall before dawn, at the place by the dyers’ quarter where the mud brick was always soft. You hear it before you see it: a sound like the market on a feast day, and then a different sound.',
      s.burnedArchives
        ? 'By full light the lower town is burning. The court has drawn back into the palace on its terrace, and from the archive stair you watch the smoke walk up the streets toward you, house by house.'
        : 'By full light the lower town is lost. From the archive stair you watch men carry out everything that shines and leave everything that is only written down.',
    ],
    king: ['The annals, scribe. Bring me the annals of my house. Leave everything else to the fire.'],
    choice: { prompt: 'You can carry one thing up the palace stair.', options: [
      { label: `The ${title}’s annals`, effects: { favour: 3, household: -1 }, consequence: `You carry the annals up the stair in a basket meant for bread, and you do not look down at the street where you live. The ${title} touches the basket as if it were a child.` },
      { label: 'Your family', effects: { household: 3, favour: -2 }, flag: 'family', consequence: `You find ${spouse} and ${child} in the cistern under the courtyard, where you told them to go if this day ever came. You climb to the palace together, and nobody asks where you were.` },
      { label: `Old ${teacher}, who taught you`, effects: { conscience: 2, household: -1 }, consequence: `${teacher} weighs no more than a sack of reeds. Halfway up the stair ${teacher} says your name, and then the name of every scribe who ever sat at your bench.` },
    ] },
    tablet: [{ slot: 'end', prompt: 'What do you write of the day the wall fell?', options: [
      o('true', 'What you saw', `The host of {enemy.name} took {city.name}${s.burnedArchives ? ' and burned it' : ' and sacked it'}.`, { conscience: 2, favour: -2 }),
      o('rounded', 'A gentler end', 'The city opened its gates to spare its people.', { favour: 1, conscience: -1 }),
      o('boasted', `As the ${title} wishes`, '{enemy.name} came against the walls of {city.name} and went away ashamed.', { favour: 2, conscience: -3 }),
    ] }],
  } : s.outcome === 'treaty' ? {
    day: 4, beat: 'end',
    scene: [
      'On the fourth day heralds come up to the gate under green branches. By evening there are terms, and by morning there is a table in the gateway with a cloth on it and two chairs, and the dust of both armies settling on the cloth.',
      `{city.name} keeps its walls and its ${title}. It gives up land to {enemy.name}. The terms are read aloud in both tongues, and the villagers who walked in to hear them walk home again, belonging to somebody else.`,
    ],
    king: ['The villages are of no account. Write that the enemy sued for peace. That is what a treaty is, scribe, when it is written properly.'],
    choice: { prompt: `The ${title} asks you to read the terms aloud at the gate.`, options: [
      { label: 'Read every term', effects: { conscience: 2, favour: -2 }, consequence: 'Your voice carries further than you expected. At the back of the crowd a man from the upper valley sits down in the dust, as if someone had cut a cord.' },
      { label: 'Leave out the villages', effects: { favour: 2, conscience: -2 }, consequence: 'The crowd cheers the peace. The envoy of {enemy.name} looks at you for a long moment and says nothing. {enemy.name} will know what it owns whether or not you say it.' },
    ] },
    tablet: [{ slot: 'end', prompt: 'What do you write of the peace?', options: [
      o('true', 'The terms as sworn', '{city.name} gave {treaty.ceded} districts to {enemy.name} to have peace.', { conscience: 2, favour: -2 }),
      o('rounded', 'Villages of no account', '{city.name} gave some villages of no account to {enemy.name}.', { favour: 1, conscience: -1 }),
      o('boasted', `As the ${title} wishes`, '{enemy.name} sued for peace at the gate of {city.name}.', { favour: 2, conscience: -3 }),
    ] }],
  } : s.outcome === 'held' ? {
    day: 4, beat: 'end',
    scene: [
      'On the fourth night the enemy’s fires are fewer, and on the fifth morning they are gone: the camp struck, the ladders burned, the orchards stripped to the bark. The walls held.',
      'The bodies below the gate are still there. Someone will have to count them, and the whole court already knows who that someone will be.',
    ],
    king: ['Write that they broke against us like water on a rock. Write it so that their grandchildren are afraid of it.'],
    choice: { prompt: 'The city is saved. What do you do with the day?', options: [
      { label: 'Count the dead by name', effects: { conscience: 2, favour: -1 }, consequence: 'It takes until dark. Some names you have to ask three times. One of them was a boy you taught his letters, and you write it in your best hand.' },
      { label: `Go to the ${title}’s feast`, effects: { favour: 2, conscience: -1, household: 1 }, consequence: `The ${title} sends you home with a whole roast bird wrapped in leaves. Nobody at the feast mentions the bodies by the gate.` },
      { label: 'Go home', effects: { household: 2, favour: -1 }, flag: 'family', consequence: `You sleep through the victory hymns and wake in the dark with ${child} asleep across your feet.` },
    ] },
    tablet: [{ slot: 'end', prompt: 'What do you write of the siege?', options: [
      o('true', 'What happened', 'The walls of {city.name} held, and {enemy.name} went home.', { conscience: 2, favour: -1 }),
      o('rounded', 'A little more', '{enemy.name} fled from the walls of {city.name}.', { favour: 1, conscience: -1 }),
      o('boasted', `As the ${title} wishes`, '{enemy.name} was destroyed before the walls of {city.name}.', { favour: 2, conscience: -3 }),
    ] }],
  } : {
    day: 4, beat: 'end',
    scene: [
      'On the fourth day the gates open from the inside. There is no fighting in the streets, only a long column of the soldiers of {enemy.name} and a herald on a mule reading out the name of the city’s new master.',
      `In the palace the servants are already taking down the hangings. In the ${house} the shelves are full, and everyone who comes through the door wants something different from them.`,
    ],
    king: [`I am still the ${title} until I am dead. Write as I tell you, and write it now, before they take the ${stuff} from you.`],
    choice: { prompt: 'The new masters want the archive. What do you do?', options: [
      { label: 'Hand it over', effects: { favour: -2, household: 2 }, consequence: 'The officer who signs for it cannot read. He counts the baskets, not the tablets, and thanks you very politely.' },
      { label: 'Hide the annals', effects: { favour: 2, household: -2 }, consequence: `Nobody stops a scribe carrying reeds. The annals spend the night under ${child}’s bed, and ${spouse} does not sleep at all.` },
    ] },
    tablet: [{ slot: 'end', prompt: 'What do you write of the surrender?', options: [
      o('true', 'What happened', 'The city of {city.name} was given to {enemy.name}.', { conscience: 2, favour: -2 }),
      o('rounded', 'A pact', `The ${title} made a pact with {enemy.name}.`, { favour: 1, conscience: -1 }),
      o('boasted', `As the ${title} wishes`, `{enemy.name} bowed before the ${title} of {state.name}.`, { favour: 2, conscience: -3 }),
    ] }],
  };

  return {
    scenario: s.id,
    title: 'The scribe of {city.name}',
    scribe: { name: nm('m', 0), sex: 'm' },
    days: [
      {
        day: 1, beat: 'muster',
        scene: [
          `Before dawn the levy gathers in the square below the palace of {city.name}: farmers with their sickles lashed to poles, the ${title}’s own guard in a block of polished helmets, boys who lied about their age. You stand on the steps beside the steward with a tally cord, counting heads by tens while the dust goes gold over the gate.`,
          `You are {scribe.name}, scribe of the palace. The count is your work, and so is the ${sheet}. It will lie in the archive long after everyone in this square is dead, and the ${title} knows it.`,
        ],
        king: [`Scribe. When {enemy.ruler.name} of {enemy.name} counts our men, let ${eh} count them on your ${stuff}. And let ${eh} count a great many.`],
        tablet: [{ slot: 'muster', prompt: 'How many marched out of {city.name}?', options: [
          o('true', 'The count', '{value} men marched out of {city.name}.', { conscience: 2, favour: -1 }),
          o('rounded', 'Rounded up', '{value} men marched out of {city.name}.', { favour: 1, conscience: -1 }),
          o('boasted', `As the ${title} wishes`, '{value} men, a host like the reeds of the marsh, marched out of {city.name}.', { favour: 2, conscience: -2 }),
        ] }],
      },
      {
        day: 2, beat: 'field',
        scene: [
          'On the second day a runner comes in through the gate with his sandals in his hand. By noon the carts follow: the wounded laid in rows on straw, the dead who could be carried, a banner wrapped around its own broken pole. The battle was fought at {battle.place}.',
          `The steward reads you the captains’ tallies: of ours, {battle.oursLost} dead; of theirs, {battle.theirsLost}. ${lost ? 'The field was lost.' : 'The field was won, at a price.'}`,
        ],
        king: [lost ? 'I do not care what the captains say. I care what the tablet says. Their dead were many. Ours were few. And they ran.' : 'We won, scribe, and I want it written the way a victory is written.'],
        tablet: [
          { slot: 'ours', prompt: 'How many of ours died at {battle.place}?', options: [
            o('true', 'The captains’ tally', 'Of the men of {city.name}, {value} fell at {battle.place}.', { conscience: 2, favour: -2 }),
            o('rounded', 'A little less grief', 'Of the men of {city.name}, {value} fell at {battle.place}.', { favour: 1, conscience: -1 }),
            o('boasted', `As the ${title} wishes`, 'Of the men of {city.name}, only {value} fell at {battle.place}.', { favour: 2, conscience: -2 }),
          ] },
          { slot: 'theirs', prompt: 'And the dead of {enemy.name}?', options: [
            o('true', 'The captains’ tally', 'Of the host of {enemy.name}, {value} lay dead.', { conscience: 2, favour: -1 }),
            o('rounded', 'A few more', 'Of the host of {enemy.name}, {value} lay dead.', { favour: 1, conscience: -1 }),
            o('boasted', 'Past counting', 'Of the host of {enemy.name}, {value} lay dead, and the crows grew fat.', { favour: 2, conscience: -2 }),
          ] },
          { slot: 'field', prompt: 'Who held the field?', options: lost ? [
            o('true', 'The truth: they did', 'The field was theirs, and our host fell back to the walls.', { conscience: 2, favour: -2 }),
            o('rounded', 'No one won', 'The two hosts parted at dusk, and neither held the field.', { favour: 1, conscience: -1 }),
            o('boasted', 'We did', '{battle.commander.name} broke the host of {enemy.name}.', { favour: 3, conscience: -3 }),
          ] : [
            o('true', 'We did, at a price', 'The field was ours, at a price.', { conscience: 2 }),
            o('rounded', 'A rout', 'The host of {enemy.name} was broken.', { favour: 1, conscience: -1 }),
            o('boasted', 'Annihilation', 'The host of {enemy.name} was destroyed to the last man.', { favour: 2, conscience: -2 }),
          ] },
        ],
      },
      {
        day: 3, beat: 'walls',
        scene: [
          'The army of {enemy.name} comes up the valley road and does not leave. From the palace roof you can see their fires, more of them each night, and the long shapes of the ladders they are building in the orchards.',
          famine
            ? `In the market a measure of grain costs {state.grain} grams of silver, where the old women remember {hardship.grainBefore}. ${spouse} has stopped eating in front of the children.`
            : `The granary is sealed, and the steward hands out bread by the tally. At home ${spouse} counts the loaves the way you count heads, and ${child} has learned not to ask.`,
        ],
        king: ['If the city asks how the war goes, the city will be told what the tablets say. Nothing more.'],
        choice: { prompt: 'What will you do tonight?', options: [
          { label: 'Write the true tally and hide it in a jar', effects: { conscience: 3, household: -1 }, flag: 'jar', consequence: `Your hands shake, so you write smaller, the way you were taught. You seal the jar with pitch and bury it under the floor of the ${house}.` },
          { label: 'Feed your house', effects: { household: 2, conscience: -1 }, consequence: `You trade the ${house}’s store of reeds for grain. That night ${child} eats until she falls asleep at the table.` },
          { label: 'Share your bread with the widow next door', effects: { conscience: 1, household: -2 }, consequence: 'She takes the bread without thanking you, the way people take what they need too badly to be polite. Her sons marched out with the levy and did not come back.' },
        ] },
      },
      endDay,
      {
        day: 5, beat: 'tablet',
        scene: [
          s.outcome === 'sacked'
            ? `The court holds the palace terrace and nothing else. On the fifth day the ${title} sends for you and for the ${sheet}, and reads it in a hall that smells of smoke.`
            : `On the fifth day the ${title} sends for you and for the ${sheet}. The hall is quiet, and the lamps are lit although it is noon.`,
          `${He} reads it slowly, with a finger under each line, the way children read. Then ${he} looks up at you.`,
        ],
        king: ['You wrote that? Read it again. Slowly. Then tell me what you meant to write.'],
        choice: { prompt: clay ? 'The clay is still soft.' : 'The ink is still wet.', options: [
          { label: 'Let it stand as written', effects: { conscience: 2, favour: -2 }, consequence: `The hall goes so quiet you can hear the lamps. The ${title} looks at you for a long time, then waves a hand, and the steward takes the ${sheet} away.` },
          { label: `Smooth it and write what the ${title} wants`, effects: { favour: 3, conscience: -2 }, consequence: `You ${clay ? 'wet the clay and press it again' : 'scrape the lines away and write them again'} while ${he} dictates: more of theirs, fewer of ours, a victory where there was none. The ${title} smiles for the first time in days.` },
          { label: 'Agree, then write the truth along the edge', effects: { conscience: 1, favour: 1, household: -1 }, flag: 'edge', consequence: `You bow and write what ${he} wants. But along the lower ${clay ? 'edge' : 'margin'}, where no reader looks, you set down the true dead in signs as small as barley grains.` },
        ] },
      },
    ],
    endings: [
      { id: 'jar', title: 'The jar beneath the floor', when: { flag: 'jar', conscience: [2, 20] }, text: `The palace ${sheet} says what the ${title} wanted, or what you dared. The jar says what happened. You never dig it up, and you tell no one, not even ${spouse}. It is enough that the ${stuff} knows.` },
      { id: 'flatterer', title: 'The rewarded flatterer', when: { favour: [6, 20] }, text: `The ${title} gave you a house by the river gate and a place at the foot of the royal table. Your ${sheet} was read aloud at the new year for as long as there was a ${title} in {city.name} to read it to.` },
      { id: 'dismissed', title: 'The dismissed honest scribe', when: { conscience: [5, 20], favour: [-20, -2] }, text: `You were sent home from the ${house} with your stylus and nothing else. By spring you were teaching merchants’ children their numbers for bread, and teaching them to count honestly.` },
      { id: 'family', title: 'The family first', when: { household: [3, 20] }, text: `You lost your bench in the ${house}, and no one in {city.name} blames you for it. ${child} learns her signs from you at night, on scraps from the ruins, and writes better than you ever did.` },
      { id: 'bent', title: 'The scribe who bent with the wind', when: {}, text: 'You wrote some things as they were and some as they were wanted, as scribes always have. You kept your bench, your house, and most of your conscience.' },
    ],
    archaeologist: {
      true: 'Excavation report, {find.year}. A battle record from the palace of {city.name}, {find.condition}. Its figures are exact: {tablet.ours} of the city’s dead at {battle.place} and {tablet.theirs} of the enemy’s, where the record gives {battle.oursLost} and {battle.theirsLost}. Its writer told the truth to a court that did not want it.',
      rounded: 'Excavation report, {find.year}. A battle record from the palace of {city.name}, {find.condition}. Its figures are a palace scribe’s: rounded, and always in the king’s favour, {tablet.ours} of the city’s dead where the record has {battle.oursLost}, and {tablet.theirs} of the enemy’s for {battle.theirsLost}. Such records are the raw material of chronicles.',
      boasted: 'Excavation report, {find.year}. This record from the palace of {city.name}, {find.condition}, belongs with the victory steles. It claims {tablet.theirs} enemy dead at {battle.place}, where the record of the battle gives {battle.theirsLost}, and admits {tablet.ours} of the city’s own for {battle.oursLost}. Kings lose wars; their scribes rarely do.',
      flags: {
        jar: 'Excavation report, {find.year}. Beneath the floor of the palace of {city.name} the excavators found a sealed jar with a single record inside, written in haste. It gives the dead of {battle.place} as {battle.oursLost} of the city and {battle.theirsLost} of the enemy: exactly the record’s figures, and the only witness of the time that agrees with it.',
        edge: 'Excavation report, {find.year}. The face of this record from {city.name} tells the king’s war: {tablet.theirs} enemy dead, {tablet.ours} of the city’s own. But along its lower edge, in signs no larger than barley grains, someone has set down two other figures: {battle.oursLost} and {battle.theirsLost}. They are the record’s.',
      },
    },
  };
}
