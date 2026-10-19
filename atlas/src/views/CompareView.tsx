import { Eyebrow, usePage } from '../components/PageCard.tsx';
import { fmtSpan } from '../format.ts';
import { titleOf } from '../store.ts';
import { norm } from './PageView.tsx';

type Verdict = 'match' | 'differs' | 'silent' | 'extra';

function parseNum(s: string): number | null {
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function judge(claim: string | undefined, truth: string | undefined): { v: Verdict; ratio: number | null } {
  if (claim === undefined) return { v: 'silent', ratio: null };
  if (truth === undefined) return { v: 'extra', ratio: null };
  if (norm(claim) === norm(truth)) return { v: 'match', ratio: null };
  const a = parseNum(claim), b = parseNum(truth);
  const ratio = a !== null && b !== null && b !== 0 && /\d/.test(claim) && /\d/.test(truth) ? a / b : null;
  if (ratio !== null && Math.abs(ratio - 1) < 0.02) return { v: 'match', ratio: null };
  return { v: 'differs', ratio };
}

function ratioText(r: number): string {
  if (r === 0) return 'none admitted';
  if (r > 1) return `×${r.toFixed(r >= 10 ? 0 : 1)} overstated`;
  return `${Math.max(1, Math.round(r * 100))}% of the record`;
}

export function CompareView({ id }: { id: string }) {
  const { page, loading, missing } = usePage(id);
  if (loading) return <div class="compare"><div class="skel skel--t" /><div class="skel" /></div>;
  if (missing || !page || !page.accounts) {
    return (
      <div class="compare">
        <h1 class="h-page">No competing accounts</h1>
        <p class="muted">This event has no surviving accounts to compare. <a href={`#/p/${id}`}>Open its page</a>.</p>
      </div>
    );
  }
  const acc = page.accounts;
  const T = (aid: string) => page.labels?.[aid] ?? titleOf(aid) ?? aid;
  const truth = new Map(acc.truth);
  const fields = [...acc.truth.map(([f]) => f)];
  for (const s of acc.sources) for (const [f] of s.claims) if (!fields.includes(f)) fields.push(f);
  const claimMaps = acc.sources.map((s) => new Map(s.claims));
  const scores = acc.sources.map((_s, i) => {
    let agree = 0, total = 0;
    for (const f of acc.truth.map(([f]) => f)) {
      const j = judge(claimMaps[i].get(f), truth.get(f));
      if (j.v === 'silent') continue;
      total++;
      if (j.v === 'match') agree++;
    }
    return { agree, total, silent: acc.truth.filter(([f]) => !claimMaps[i].has(f)).length };
  });

  const cell = (f: string, i: number) => {
    const c = claimMaps[i].get(f);
    const j = judge(c, truth.get(f));
    return (
      <td class={`cmp__c is-${j.v}`}>
        {j.v === 'silent' ? <span class="cmp__silent">— not mentioned</span> : <span>{c}</span>}
        {j.v === 'differs' && j.ratio !== null && Math.abs(j.ratio - 1) >= 0.02 && (
          <span class={`cmp__ratio ${j.ratio > 1 ? 'up' : 'down'}`}>{ratioText(j.ratio)}</span>
        )}
        {j.v === 'differs' && j.ratio === null && <span class="cmp__flag">differs</span>}
      </td>
    );
  };

  return (
    <div class="compare">
      <header class="compare__head">
        <Eyebrow kind="event" sub={page.sub} />
        <h1 class="reader__title">{page.title}</h1>
        <div class="reader__meta">{fmtSpan(page.t0, page.t1)} · <a href={`#/p/${page.id}`}>Event page</a></div>
        <p class="compare__lede">
          The record knows what happened. The people who wrote it down did not — or would not say. Each surviving account is a projection
          of the record through its author’s loyalties: casualties inflated or hidden, blame reversed, defeats omitted. Highlighted cells
          disagree with the record. <a href="#/game">Can you tell how far each scribe lies? Play the game →</a>
        </p>
      </header>

      <div class="cmp-scores">
        {acc.sources.map((s, i) => (
          <a class="cmp-score" href={`#/p/${s.artifactId}`}>
            <span class="cmp-score__t">{T(s.artifactId)}</span>
            <span class="cmp-score__m">{s.author} · for {s.side}</span>
            <span class="cmp-score__bar" aria-hidden="true"><span style={{ width: `${scores[i].total ? (scores[i].agree / scores[i].total) * 100 : 0}%` }} /></span>
            <span class="cmp-score__n">{scores[i].agree} of {scores[i].total} claims match the record{scores[i].silent ? ` · silent on ${scores[i].silent}` : ''}</span>
          </a>
        ))}
      </div>

      <div class="table-wrap cmp-wrap">
        <table class="cmp">
          <thead>
            <tr>
              <th class="cmp__f">Field</th>
              <th class="cmp__truth">The record</th>
              {acc.sources.map((s) => <th><a href={`#/p/${s.artifactId}`}>{T(s.artifactId)}</a><div class="muted small">{s.side}</div></th>)}
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr>
                <th scope="row" class="cmp__f">{f}</th>
                <td class="cmp__truth">{truth.get(f) ?? <span class="muted">—</span>}</td>
                {acc.sources.map((_s, i) => cell(f, i))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div class="cmp-cards">
        {acc.sources.map((s, i) => (
          <section class="cmp-card">
            <h2 class="cmp-card__t"><a href={`#/p/${s.artifactId}`}>{T(s.artifactId)}</a></h2>
            <div class="muted small">{s.author} · for {s.side}</div>
            <dl class="cmp-card__dl">
              {fields.map((f) => {
                const c = claimMaps[i].get(f);
                const t = truth.get(f);
                const j = judge(c, t);
                return (
                  <div class={`cmp-card__row is-${j.v}`}>
                    <dt>{f}</dt>
                    <dd>
                      {j.v === 'silent' ? <span class="cmp__silent">— not mentioned</span> : c}
                      {j.v === 'differs' && t && <div class="cmp-card__truth">Record: {t}{j.ratio !== null && Math.abs(j.ratio - 1) >= 0.02 ? ` · ${ratioText(j.ratio)}` : ''}</div>}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
      </div>
    </div>
  );
}
