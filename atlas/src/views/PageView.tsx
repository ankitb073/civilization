import { useEffect, useMemo, useState } from 'preact/hooks';
import type { PageJson } from '../../../engine/src/export/contract.ts';
import { Eyebrow, Html, usePage } from '../components/PageCard.tsx';
import { Sparkline } from '../components/Sparkline.tsx';
import { fmtSpan, fmtYear, subLabel } from '../format.ts';
import { KIND_LABEL, KINDS, kindFromId } from '../kinds.ts';
import { inline, render } from '../md.ts';
import { isMobile, mapHref, year } from '../state.ts';
import { titleOf } from '../store.ts';

const MAP_SELECTABLE = new Set(['polity', 'settlement', 'event', 'culture', 'movement']);

export function docStyle(sub: string): string {
  const s = sub.toLowerCase();
  if (/inscription|stele|epitaph|dedication|boundary|votive|monument|graffit/.test(s)) return 'stone';
  if (/ledger|account|day-?book|tax|census|roll|register/.test(s)) return 'ledger';
  if (/treaty|charter|accord|pact|alliance|truce/.test(s)) return 'treaty';
  if (/newspaper|gazette|bulletin|broadsheet|news/.test(s)) return 'news';
  if (/telegram|cable|wire/.test(s)) return 'telegram';
  if (/letter|correspondence|dispatch|missive/.test(s)) return 'letter';
  if (/chronicle|annal|history|histor/.test(s)) return 'chronicle';
  if (/decree|edict|law|proclamation|ordinance|statute/.test(s)) return 'decree';
  if (/scripture|treatise|polemic|sermon|creed|dialogue|hymn|commentary/.test(s)) return 'treatise';
  if (/pamphlet|broadside|manifesto/.test(s)) return 'pamphlet';
  if (/paper|report|yearbook|statistic|minutes|record|survey|transcript/.test(s)) return 'report';
  if (/coin/.test(s)) return 'coin';
  return 'paper';
}

export function PageView({ id }: { id: string }) {
  const { page, loading, missing } = usePage(id);
  useEffect(() => {
    if (page) document.title = `${page.title} — Palimpsest`;
  }, [page]);
  if (loading) return <article class="reader"><div class="reader__main"><div class="skel skel--t" /><div class="skel" /><div class="skel" /><div class="skel skel--s" /></div></article>;
  if (missing || !page) {
    return (
      <article class="reader reader--empty">
        <div class="reader__main">
          <Eyebrow kind={kindFromId(id) ?? 'artifact'} />
          <h1 class="reader__title">Not in the archive</h1>
          <p class="muted">There is no page for <code>{id}</code>. It may have been lost — or never written.</p>
          <p><a class="btn" href="#/browse">Browse the archive</a></p>
        </div>
      </article>
    );
  }
  return <Page page={page} />;
}

/** Display title for an id referenced by a page: the page's own label map first. */
export function labeler(page: PageJson) {
  return (id: string): string | undefined => page.labels?.[id] ?? titleOf(id);
}

function Page({ page }: { page: PageJson }) {
  const label = labeler(page);
  const bodyHtml = useMemo(() => render(page.body, label), [page]);
  const a = page.artifact;
  const style = page.kind === 'artifact' ? docStyle(page.sub) : '';
  const y = year.value;
  const mapYear = y >= page.t0 && y <= page.t1 ? y : page.t0;
  const mapLink = page.cell >= 0 || MAP_SELECTABLE.has(page.kind)
    ? mapHref({ y: mapYear, sel: MAP_SELECTABLE.has(page.kind) ? page.id : page.cell >= 0 ? `cell:${page.cell}` : null })
    : null;

  const mobile = isMobile.value;
  const hasAside = (!mobile && page.infobox.length > 0) || (page.series?.length ?? 0) > 0 || (page.names?.length ?? 0) > 0;
  return (
    <article class={`reader reader--${page.kind}${hasAside ? '' : ' reader--single'}`}>
      <div class="reader__main">
        <header class="reader__head">
          <Eyebrow kind={page.kind} sub={page.sub} />
          <h1 class="reader__title">{page.title}</h1>
          <div class="reader__meta">
            <span class="reader__span">{page.kind === 'artifact' && a ? <>{a.date ? <><span class="reader__local">{a.date}</span> · </> : null}{fmtYear(page.t0)}</> : fmtSpan(page.t0, page.t1)}</span>
            {a?.flagship && <span class="badge badge--flag" title="Written by hand from the archive's dossier">Flagship</span>}
          </div>
          {page.summary && <Html tag="p" class="reader__summary" html={inline(page.summary, label)} />}
          <div class="actions">
            {mapLink && <a class="btn" href={mapLink}>
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
              View on map</a>}
            <a class="btn btn--ghost" href={`#/graph?focus=${encodeURIComponent(page.id)}&y=${page.t0}`}>Graph</a>
            {page.accounts && page.accounts.sources.length > 0 && <a class="btn btn--accent" href={`#/compare/${page.id}`}>Compare accounts</a>}
            {a?.rival && <a class="btn btn--accent" href={`#/compare/${a.rival.eventId}`}>Compare with rival accounts</a>}
            <ShareButton title={page.title} />
          </div>
        </header>

        {mobile && page.infobox.length > 0 && <Infobox page={page} label={label} inline />}

        {a && page.infobox.length === 0 && <CatalogPlate page={page} label={label} />}

        {a?.interlinear && <Interlinear it={a.interlinear} />}

        {page.body.trim() && (
          <section class={`doc${style ? ` doc--${style}` : ''}`} aria-label={page.kind === 'artifact' ? 'Text' : 'Article'}>
            {page.kind === 'artifact' && a?.interlinear && <div class="doc__label">Commentary</div>}
            {page.kind === 'artifact' && !a?.interlinear && <div class="doc__label">{style === 'stone' ? 'Text' : 'Translation'}</div>}
            <Html class="doc__body prose" html={bodyHtml} />
          </section>
        )}

        {a?.ledger && <Ledger ledger={a.ledger} label={label} />}

        {page.accounts && page.accounts.sources.length > 0 && <AccountsTeaser page={page} label={label} />}

        {page.language && <LanguagePanel lang={page.language} label={label} />}

        <LinkLists page={page} />
      </div>

      {hasAside && <aside class="reader__aside">
        {!mobile && page.infobox.length > 0 && <Infobox page={page} label={label} />}
        {page.series && page.series.length > 0 && (
          <section class="aside-sect">
            <h2 class="sect">Over time</h2>
            {page.series.map((s) => <Sparkline series={s} />)}
          </section>
        )}
        {page.names && page.names.length > 0 && <Names names={page.names} />}
      </aside>}
    </article>
  );
}

function Infobox({ page, label, inline: isInline = false }: { page: PageJson; label: (id: string) => string | undefined; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  const rows = isInline && !open ? page.infobox.slice(0, 6) : page.infobox;
  return (
    <section class={`infobox${isInline ? ' infobox--inline' : ''}`} aria-label="Facts">
      <dl class="kv">
        {rows.map(([k, v]) => (
          <>
            <dt>{k}</dt>
            <Html tag="dd" html={inline(v, label)} />
          </>
        ))}
      </dl>
      {isInline && page.infobox.length > 6 && (
        <button class="linkish small infobox__more" onClick={() => setOpen(!open)}>{open ? 'Fewer facts' : `All ${page.infobox.length} facts`}</button>
      )}
    </section>
  );
}

function ShareButton({ title }: { title: string }) {
  const [done, setDone] = useState(false);
  const share = async () => {
    const url = location.href;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title, url });
      else { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 1600); }
    } catch { /* cancelled */ }
  };
  return <button class="btn btn--ghost" onClick={share}>{done ? 'Link copied' : 'Share'}</button>;
}

function CatalogPlate({ page, label }: { page: PageJson; label: (id: string) => string | undefined }) {
  const a = page.artifact!;
  const rows: [string, preact.ComponentChildren, boolean?][] = [
    ['Catalogue', <span class="mono">{a.catalog}</span>],
    ['Medium', a.medium],
    ['Date', <>{a.date ? <>{a.date} <span class="muted">({fmtYear(page.t0)})</span></> : fmtYear(page.t0)}</>, true],
    ['Language', a.language],
    ['Script', a.script],
  ];
  let optional = 0;
  if (a.authorId) { rows.push(['Author', <a href={`#/p/${a.authorId}`}>{label(a.authorId) ?? a.authorId}</a>]); optional++; }
  if (a.translatorId) { rows.push(['Translated by', <a href={`#/p/${a.translatorId}`}>{label(a.translatorId) ?? a.translatorId}</a>]); optional++; }
  rows.push(['Condition', a.condition, optional % 2 === 0]);
  rows.push(['Provenance', a.provenance, true]);
  return (
    <section class="plate" aria-label="Catalogue entry">
      <dl class="plate__grid">
        {rows.map(([k, v, wide]) => (
          <div class={`plate__row${wide ? ' plate__row--wide' : ''}`}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function glossHtml(g: string): string {
  const esc = g.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return esc.replace(/\b([1-3]?(?:[A-Z]{2,}|SG|PL|DU)(?:\.[A-Z0-9]+)*)\b/g, (m) => `<span class="sc">${m.toLowerCase()}</span>`);
}

function Interlinear({ it }: { it: NonNullable<NonNullable<PageJson['artifact']>['interlinear']> }) {
  return (
    <section class="stele" aria-label="Inscription">
      <div class="stele__inner">
        <div class="stele__block">
          <div class="doc__label">Transliteration</div>
          <p class="stele__translit">{it.transliteration}</p>
        </div>
        <div class="stele__block">
          <div class="doc__label">Normalized</div>
          <p class="stele__norm">{it.normalized}</p>
        </div>
        {it.tokens.length > 0 && (
          <div class="stele__block">
            <div class="doc__label">Interlinear gloss</div>
            <div class="igt">
              {it.tokens.map((t) => (
                <div class="igt__w">
                  <span class="igt__seg">{t.segmented || t.normalized}</span>
                  <span class="igt__gl" dangerouslySetInnerHTML={{ __html: glossHtml(t.gloss) }} />
                </div>
              ))}
            </div>
          </div>
        )}
        <div class="stele__block">
          <div class="doc__label">Translation</div>
          <blockquote class="stele__trans">“{it.translation}”</blockquote>
        </div>
      </div>
    </section>
  );
}

function Ledger({ ledger, label }: { ledger: NonNullable<NonNullable<PageJson['artifact']>['ledger']>; label: (id: string) => string | undefined }) {
  const numeric = ledger.columns.map((_, c) => ledger.rows.length > 0 && ledger.rows.every((r) => /^[−\-+]?[\d,.\s]*$/.test(r[c] ?? '') && (r[c] ?? '') !== ''));
  return (
    <section class="ledger" aria-label="Ledger">
      <div class="doc__label">Entries</div>
      <div class="table-wrap">
        <table>
          <thead><tr>{ledger.columns.map((c, i) => <th class={numeric[i] ? 'r' : ''}>{c}</th>)}</tr></thead>
          <tbody>
            {ledger.rows.map((r) => (
              <tr>{r.map((c, i) => <td class={numeric[i] ? 'r num' : ''}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {ledger.notes.length > 0 && (
        <ol class="ledger__notes">
          {ledger.notes.map((n) => <li><Html tag="span" html={inline(n, label)} /></li>)}
        </ol>
      )}
    </section>
  );
}

function AccountsTeaser({ page, label }: { page: PageJson; label: (id: string) => string | undefined }) {
  const acc = page.accounts!;
  const truth = new Map(acc.truth);
  return (
    <section class="teaser">
      <div class="teaser__head">
        <h2 class="sect">Competing accounts</h2>
        <a class="btn btn--accent" href={`#/compare/${page.id}`}>Compare side by side</a>
      </div>
      <ul class="teaser__list">
        {acc.sources.map((s) => {
          let agree = 0, total = 0;
          for (const [f, v] of s.claims) if (truth.has(f)) { total++; if (norm(v) === norm(truth.get(f)!)) agree++; }
          return (
            <li>
              <a href={`#/p/${s.artifactId}`}>{label(s.artifactId) ?? s.artifactId}</a>
              <span class="muted"> — {s.author}, for {s.side}. </span>
              <span class="agree">{agree}/{total} claims match the record</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9À-ɏ]+/g, ' ').trim();
}

function Names({ names }: { names: NonNullable<PageJson['names']> }) {
  const sorted = names.slice().sort((a, b) => a.year - b.year);
  return (
    <section class="aside-sect names">
      <h2 class="sect">Names through time</h2>
      <ol class="names__list">
        {sorted.map((n) => (
          <li class="names__item">
            <span class="names__y">{n.year}</span>
            <span class="names__f">{n.form}</span>
            {n.scholarly && n.scholarly !== n.form && <span class="names__s">{n.scholarly}</span>}
            <span class="names__l">{n.lang}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function LanguagePanel({ lang, label }: { lang: NonNullable<PageJson['language']>; label: (id: string) => string | undefined }) {
  const [all, setAll] = useState(false);
  const changes = lang.soundChanges.slice().sort((a, b) => a.year - b.year);
  const shown = all ? changes : changes.slice(0, 14);
  return (
    <section class="langpanel">
      <div class="langpanel__fam">
        {lang.parent && <div><span class="muted">Descends from </span><a href={`#/p/${lang.parent}`}>{label(lang.parent) ?? lang.parent}</a></div>}
        {lang.daughters.length > 0 && (
          <div><span class="muted">Daughter languages: </span>{lang.daughters.map((d, i) => <>{i > 0 && ', '}<a href={`#/p/${d}`}>{label(d) ?? d}</a></>)}</div>
        )}
      </div>
      {lang.words.length > 0 && (
        <>
          <h2 class="sect">Words through time</h2>
          <div class="table-wrap">
            <table class="words">
              <thead><tr><th>Meaning</th><th>Forms (oldest → latest)</th></tr></thead>
              <tbody>
                {lang.words.map((w) => (
                  <tr>
                    <td class="words__c">‘{w.concept}’</td>
                    <td class="words__f">
                      {w.forms.map(([yy, f], i) => (
                        <>
                          {i > 0 && <span class="arrow" aria-hidden="true">→</span>}
                          <span class="wf" title={fmtYear(yy)}><i>{f}</i><small>{yy}</small></span>
                        </>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {changes.length > 0 && (
        <>
          <h2 class="sect">Sound changes <span class="muted small">({changes.length})</span></h2>
          <ol class="sc-list">
            {shown.map((c) => (
              <li class="sc-item">
                <span class="sc-item__y">{c.year}</span>
                <code class="sc-item__r">{c.rule}</code>
                <span class="sc-item__l">{c.label}</span>
                <span class="sc-item__lang">{c.lang}</span>
              </li>
            ))}
          </ol>
          {changes.length > 14 && <button class="btn btn--ghost" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${changes.length}`}</button>}
        </>
      )}
    </section>
  );
}

function LinkLists({ page }: { page: PageJson }) {
  const label = labeler(page);
  const more = Math.max(0, (page.backlinkCount ?? page.backlinks.length) - page.backlinks.length);
  return (
    <div class="linklists">
      {page.links.length > 0 && <Grouped title="Mentions" ids={page.links} label={label} />}
      {page.backlinks.length > 0 && <Grouped title="Referenced by" ids={page.backlinks} label={label} total={page.backlinkCount} more={more} />}
    </div>
  );
}

function Grouped({ title, ids, label, total, more = 0 }: { title: string; ids: string[]; label: (id: string) => string | undefined; total?: number; more?: number }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const id of ids) {
      const k = kindFromId(id) ?? 'other';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(id);
    }
    return KINDS.filter((k) => m.has(k)).map((k) => [k, m.get(k)!] as const);
  }, [ids]);
  const LIMIT = 12;
  return (
    <section class="grouped">
      <h2 class="sect">{title} <span class="muted small">({(total ?? ids.length).toLocaleString('en-US')})</span></h2>
      {groups.map(([k, list]) => {
        const isOpen = open[k];
        const items = isOpen ? list : list.slice(0, LIMIT);
        return (
          <div class="grouped__g">
            <h3 class="grouped__k"><span class={`kdot k-${k}`} aria-hidden="true" />{KIND_LABEL[k][list.length === 1 ? 0 : 1]} <span class="muted">{list.length}</span></h3>
            <ul class="grouped__list">
              {items.map((id) => <li><a href={`#/p/${id}`}>{label(id) ?? id}</a></li>)}
            </ul>
            {list.length > LIMIT && <button class="linkish small" onClick={() => setOpen({ ...open, [k]: !isOpen })}>{isOpen ? 'Show fewer' : `Show all ${list.length}`}</button>}
          </div>
        );
      })}
      {more > 0 && <p class="muted small grouped__more">…and {more.toLocaleString('en-US')} more pages refer here. <a href="#/browse">Browse the archive</a> to find them by kind and period.</p>}
    </section>
  );
}

export { subLabel };
