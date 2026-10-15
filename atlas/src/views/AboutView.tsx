import { useEffect } from 'preact/hooks';
import { fmtBytes } from '../format.ts';
import { KIND_LABEL, KINDS } from '../kinds.ts';
import { ensureMeta, meta } from '../store.ts';
import { mapHref } from '../state.ts';
import { Featured } from './MapPanel.tsx';

export function AboutView() {
  const m = meta.value;
  useEffect(() => { ensureMeta().catch(() => {}); }, []);
  if (!m) return <div class="center-load"><div class="spinner" /> Loading…</div>;
  const base = import.meta.env.BASE_URL;
  const totalChecks = m.check.invariants.reduce((s, i) => s + i.checked, 0);
  const totalViol = m.check.invariants.reduce((s, i) => s + i.violations, 0);
  return (
    <div class="about">
      <header class="about__hero">
        <div class="wordmark wordmark--xl">{m.title}</div>
        <p class="about__sub">{m.subtitle}</p>
        <p class="about__lede">
          One seed. Fifty centuries simulated one decade at a time — borders, harvests, coinage, sound laws, schisms and wars —
          and then the archive such a world would leave behind: treaties, ledgers, inscriptions and histories that disagree.
          Every document links to everything it mentions, and every claim is checked against the record.
        </p>
        <div class="proof" role="note">
          <span class={`proof__badge ${m.check.passed && totalViol === 0 ? 'is-ok' : 'is-bad'}`}>{m.check.passed && totalViol === 0 ? '✓ Consistent' : '✗ Violations'}</span>
          <span class="proof__n">{totalChecks.toLocaleString('en-US')}</span>
          <span class="proof__t">facts checked against the causal record across {m.check.invariants.length} invariants — {totalViol === 0 ? 'zero violations' : `${totalViol.toLocaleString('en-US')} violations`}.</span>
          <a class="proof__a" href="#consistency" onClick={(e) => { e.preventDefault(); document.getElementById('consistency')?.scrollIntoView({ behavior: 'smooth' }); }}>See the report</a>
        </div>
        <div class="actions">
          <a class="btn btn--accent" href={mapHref({ y: 0 })}>Start at year 0</a>
          <a class="btn" href="#/browse">Browse the archive</a>
          <a class="btn btn--ghost" href="https://github.com/ankitb073/civilization" target="_blank" rel="noopener">Source on GitHub</a>
        </div>
      </header>

      <section class="about__sect">
        <h2 class="sect">What’s inside</h2>
        <div class="stats">
          {KINDS.filter((k) => m.counts[k]).map((k) => (
            <a class="stat" href={`#/browse?kind=${k}`}>
              <span class="stat__n">{m.counts[k].toLocaleString('en-US')}</span>
              <span class="stat__l"><span class={`kdot k-${k}`} aria-hidden="true" />{KIND_LABEL[k][1]}</span>
            </a>
          ))}
          {m.counts.links ? (
            <div class="stat">
              <span class="stat__n">{m.counts.links.toLocaleString('en-US')}</span>
              <span class="stat__l">Links (all bidirectional)</span>
            </div>
          ) : null}
        </div>
      </section>

      <section class="about__sect">
        <h2 class="sect">Start here</h2>
        <Featured limit={20} />
      </section>

      <section class="about__sect" id="consistency">
        <h2 class="sect">Consistency report</h2>
        <p class="muted">
          {m.check.passed ? 'Passed.' : 'Failed.'} {totalChecks.toLocaleString('en-US')} checks across {m.check.invariants.length} invariants,{' '}
          {totalViol === 0 ? 'with no violations.' : `${totalViol.toLocaleString('en-US')} violations.`} The build fails if any invariant is violated.
        </p>
        <div class="table-wrap">
          <table class="report">
            <thead><tr><th>Invariant</th><th class="r">Checked</th><th class="r">Violations</th><th>Status</th></tr></thead>
            <tbody>
              {m.check.invariants.map((inv) => (
                <tr>
                  <td>{inv.title}</td>
                  <td class="r num">{inv.checked.toLocaleString('en-US')}</td>
                  <td class="r num">{inv.violations.toLocaleString('en-US')}</td>
                  <td><span class={`badge ${inv.violations === 0 ? 'badge--ok' : 'badge--bad'}`}>{inv.violations === 0 ? 'Pass' : 'Fail'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section class="about__sect">
        <h2 class="sect">The ages</h2>
        <ol class="eras">
          {m.eras.map((e) => (
            <li>
              <a href={mapHref({ y: e.start })}>
                <span class="eras__y">{e.start}–{e.end}</span>
                <span class="eras__n">{e.name}</span>
                <span class="eras__b">{e.blurb}</span>
              </a>
            </li>
          ))}
        </ol>
      </section>

      <section class="about__sect about__method">
        <h2 class="sect">How it was made</h2>
        <ol class="method">
          <li><strong>World.</strong> A continent is grown from the seed: Voronoi cells, elevation, rivers by flow accumulation, rain shadows, biomes and resources.</li>
          <li><strong>Simulation.</strong> Fifty centuries in decade steps. Climate anomalies move harvests; harvests move populations, prices and revolts; polities expand, marry, fight, debase their coin and collapse. Every change is made by an event that records its causes.</li>
          <li><strong>Languages.</strong> Each people speaks a generated language that changes by regular sound laws. Place names drift with them; neighbours borrow and mangle them.</li>
          <li><strong>Archive.</strong> Treaties, ledgers, inscriptions, chronicles, letters, newspapers and more are written from the database, in the voice of their age, by authors with loyalties.</li>
          <li><strong>Checker.</strong> No document cites an event before it happened, names a king out of office, or uses a script not yet invented. The table above is regenerated on every build.</li>
        </ol>
        <p class="muted small">Seed <span class="mono">{m.seed}</span> · engine {m.engineVersion} · editorial language {m.editorialLanguage} · dates in {m.yearLabel} (Archive Years)</p>
      </section>

      {m.downloads.length > 0 && (
        <section class="about__sect">
          <h2 class="sect">Download the world</h2>
          <ul class="downloads">
            {m.downloads.map((d) => (
              <li><a class="dl" href={d.href.startsWith('http') ? d.href : base + d.href}><span>{d.label}</span><span class="muted">{fmtBytes(d.bytes)}</span></a></li>
            ))}
          </ul>
        </section>
      )}

      <footer class="about__foot muted small">
        Open source under the MIT licence. Fiction from top to bottom: any resemblance to real peoples comes from shared dynamics, not copying.
      </footer>
    </div>
  );
}
