import { useEffect } from 'preact/hooks';

// The front door to everything you can play with or wander through: one tile per experience.
type Tile = { href: string; title: string; line: string; tag: string; glyph: string; hue: number };

const TILES: Tile[] = [
  { href: '#/tablet', title: 'The Tablet House', line: 'Be the palace scribe of a city in the week it falls. The king wants smaller dead and bigger victories. What will you press into the clay?', tag: 'Game', glyph: '✎', hue: 28 },
  { href: '#/3d', title: 'The world in 3D', line: 'Orbit the continent and watch five thousand years of borders rise and fall.', tag: '3D', glyph: '◭', hue: 200 },
  { href: '#/river', title: 'The River of Time', line: 'Every state as a ridge in a valley of years. Fly from AY 0 to 5000.', tag: '3D', glyph: '≋', hue: 170 },
  { href: '#/battle/evt:39484', title: 'Battle dioramas', line: 'Khambive, AY 4139: the record’s armies, and the ghost armies the stele claimed.', tag: '3D', glyph: '⚔', hue: 12 },
  { href: '#/city/set:7', title: 'Cities through time', line: 'Ane from a riverside village to an industrial port, built from its census.', tag: '3D', glyph: '⌂', hue: 35 },
  { href: '#/museum', title: 'The Museum', line: 'Steles, tablets and coins as objects, carved with their own text.', tag: '3D', glyph: '⬒', hue: 45 },
  { href: '#/figures', title: 'The figurines', line: 'Every person in the record as a game piece: the same face of history everywhere.', tag: '3D', glyph: '♜', hue: 280 },
  { href: '#/cards', title: 'Clash of the Ages', line: 'A daily card duel: rulers, generals, states and faiths, every number from the record.', tag: 'Game', glyph: '♛', hue: 340 },
  { href: '#/game', title: 'Catch the lying chronicle', line: 'Two scribes, one war, two sets of dead. Guess the truth.', tag: 'Game', glyph: '⚖', hue: 0 },
  { href: '#/collections/tales', title: 'Tales of Yüvinzhi', line: 'Short stories set at real moments of the record, checked against it.', tag: 'Read', glyph: '❦', hue: 25 },
  { href: '#/collections/lives', title: 'A hundred Lives', line: 'Rulers, generals, inventors, envoys, priests, rebels and the rest.', tag: 'Read', glyph: '✒', hue: 30 },
  { href: '#/collections/history', title: 'A History of Yüvinzhi', line: 'Five thousand years in twenty-one chapters, citing the sources.', tag: 'Read', glyph: '❧', hue: 20 },
  { href: '#/map', title: 'The atlas', line: 'The map with its time slider, every state, city and battle.', tag: 'Explore', glyph: '◎', hue: 210 },
  { href: '#/graph', title: 'The graph', line: 'Every person, place and event, and how they connect.', tag: 'Explore', glyph: '✳', hue: 230 },
  { href: '#/words', title: 'The Word Machine', line: 'Follow one word through every language and sound change.', tag: 'Explore', glyph: 'ʔ', hue: 260 },
];

export function PlayView() {
  useEffect(() => { document.title = 'Play — Palimpsest'; }, []);
  return (
    <div class="play">
      <header class="play__head">
        <p class="eyebrow">Palimpsest</p>
        <h1 class="h-page">Play with a world that never existed</h1>
        <p class="play__lede">Everything here is generated from one simulated record of five thousand years, and nothing contradicts it.</p>
      </header>
      <ul class="play__grid">
        {TILES.map((t) => (
          <li>
            <a class="play__tile" href={t.href} style={`--h:${t.hue}`}>
              <span class="play__glyph" aria-hidden="true">{t.glyph}</span>
              <span class="play__tag">{t.tag}</span>
              <span class="play__title">{t.title}</span>
              <span class="play__line">{t.line}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
