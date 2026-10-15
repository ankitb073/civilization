import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PageJson } from '../../../engine/src/export/contract.ts';
import { Eyebrow, Html, usePage } from '../components/PageCard.tsx';
import { Sparkline } from '../components/Sparkline.tsx';
import { fmtBytes, fmtSpan, fmtYear, subLabel } from '../format.ts';
import { KIND_LABEL, KINDS, kindFromId } from '../kinds.ts';
import { inline, render } from '../md.ts';
import { isMobile, mapHref, reducedMotion, route, year } from '../state.ts';
import { PersonHouse, PolityDynasties } from './DynastyView.tsx';
import { CiteButton } from '../components/Cite.tsx';
import { Territory } from '../components/Territory.tsx';
import { meta, titleOf } from '../store.ts';
import { GENRE_HTML, sections, wordCount } from '../genres.ts';
import { chapterCount, ensureCollections, hrefOf, markDone, markOpened, partName, placeOf, readerDownload, type Place } from '../book.ts';

const DOC_LABEL: Record<string, string> = {
  verse: 'Verse, in translation', diary: 'Entries, in translation', glossary: 'Word list', muster: 'Muster roll',
  will: 'Testament, in translation', exercise: 'Exercise, with the teacher’s corrections', graffito: 'Scratched on the stone',
  almanac: 'The year’s calendar', lawsuit: 'Case record, in translation', manifest: 'Harbour register',
  omen: 'Tablet, in translation', periplus: 'The route, in translation', tariff: 'Schedule of dues, in translation',
};

const MAP_SELECTABLE = new Set(['polity', 'settlement', 'event', 'culture', 'movement']);

export function docStyle(sub: string): string {
  const s = sub.toLowerCase();
  if (s === 'omen' || s === 'periplus' || s === 'tariff') return s;
  if (/glossary|word-?list|lexicon/.test(s)) return 'glossary';
  if (/muster/.test(s)) return 'muster';
  if (/\bwill\b|testament/.test(s)) return 'will';
  if (/exercise/.test(s)) return 'exercise';
  if (/graffit/.test(s)) return 'graffito';
  if (/almanac|calendar/.test(s)) return 'almanac';
  if (/lawsuit|court|trial/.test(s)) return 'lawsuit';
  if (/manifest|port-?register|cargo/.test(s)) return 'manifest';
  if (/poem|verse|song|hymn|elegy|lament|ode|epic/.test(s)) return 'verse';
  if (/diary|journal|day-?book of/.test(s)) return 'diary';
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
  const a = page.artifact;
  const style = page.kind === 'artifact' ? docStyle(page.sub) : '';
  const { html: bodyHtml, heads } = useMemo(() => {
    let md = page.body;
    // the structured language panel below replaces the plain sound-change list
    if (page.language) md = md.replace(/^##\s+(Sound changes|Daughter languages)\s*\n[\s\S]*?(?=^##\s|(?![\s\S]))/gm, '');
    const html = render(md, label, { breaks: style === 'verse' });
    return sections(GENRE_HTML[style]?.(html) ?? html);
  }, [page]);
  const words = useMemo(() => (a ? wordCount(page.body) : 0), [page]);
  // flagships may be chapters of a book (an ordered collection): fetch the collections to find out
  useEffect(() => { if (a?.flagship) ensureCollections().catch(() => {}); }, [page.id]);
  const place = a?.flagship ? placeOf(page.id) : null;
  useEffect(() => { if (place) markOpened(place); }, [place?.c, place?.i]);
  const book = !!place || words >= 1500;
  const hist = place?.c.id === 'history';
  const y = year.value;
  const mapYear = y >= page.t0 && y <= page.t1 ? y : page.t0;
  const mapLink = page.cell >= 0 || MAP_SELECTABLE.has(page.kind)
    ? mapHref({ y: mapYear, sel: MAP_SELECTABLE.has(page.kind) ? page.id : page.cell >= 0 ? `cell:${page.cell}` : null })
    : null;

  const mobile = isMobile.value;
  const hasAside = (!mobile && page.infobox.length > 0) || (page.series?.length ?? 0) > 0 || (page.names?.length ?? 0) > 0 || page.kind === 'polity';
  return (
    <article class={`reader reader--${page.kind}${hasAside ? '' : ' reader--single'}${book ? ' reader--book' : ''}`}>
      <div class="reader__main">
        {place && <BookNav place={place} />}
        <header class="reader__head">
          <Eyebrow kind={page.kind} sub={page.sub} label={hist ? <><a href="#/collections/history">{place!.c.title}</a> · {partName(place!.c, place!.i)}</> : undefined} />
          <h1 class="reader__title">{page.title}</h1>
          <div class="reader__meta">
            <span class="reader__span">{page.kind === 'artifact' && a
              ? <>{a.date && a.date !== `AY ${page.t0}` ? <><Html tag="span" class="reader__local" html={inline(a.date.replace(/\s*\[AY -?\d+\]\s*$/, ''), label)} /> · </> : null}<YearLink y={page.t0} /></>
              : <YearSpan t0={page.t0} t1={page.t1} />}{words >= 600 && <> · <span class="nowrap">{Math.max(1, Math.round(words / 230))} min read</span></>}</span>
            {a?.flagship && (
              <a class="badge badge--flag" href="#/browse?kind=artifact&flag=1" title="A flagship source: written in full from the archive’s dossier and checked against the record like every other document">
                <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M8 1.5l1.9 4.1 4.5.5-3.4 3 1 4.4L8 11.3 4 13.5l1-4.4-3.4-3 4.5-.5z" fill="currentColor" /></svg>
                Flagship source
              </a>
            )}
          </div>
          {page.summary && !hist && <Html tag="p" class="reader__summary" html={inline(page.summary, label)} />}
          <div class="actions">
            {mapLink && <a class="btn" href={mapLink}>
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" /></svg>
              View on map</a>}
            <a class="btn btn--ghost" href={`#/graph?focus=${encodeURIComponent(page.id)}&y=${page.t0}`}>Graph</a>
            {page.accounts && page.accounts.sources.length > 0 && <a class="btn btn--accent" href={`#/compare/${page.id}`}>Compare accounts</a>}
            {a?.rival && <a class="btn btn--accent" href={`#/compare/${a.rival.eventId}`}>Compare with rival accounts</a>}
            {(page.kind === 'currency' || (page.kind === 'artifact' && /ledger|market/.test(page.sub))) && <a class="btn btn--ghost" href="#/prices">Prices over 5,000 years</a>}
            {page.kind === 'language' && <a class="btn btn--ghost" href="#/languages">Tree of Tongues</a>}
            {page.kind === 'language' && <a class="btn btn--ghost" href={`#/words/water?l=${page.id}`}>Word Machine</a>}
            {a && <CiteButton page={page} label={label} />}
            <ShareButton title={page.title} path={a?.permalink} />
          </div>
        </header>

        {mobile && !book && page.infobox.length > 0 && <Infobox page={page} label={label} inline />}

        {a && page.infobox.length === 0 && <CatalogPlate page={page} label={label} />}

        {a?.interlinear && <Interlinear it={a.interlinear} label={label} />}

        {book && heads.length >= 3 && <Contents heads={heads} />}

        {bodyHtml.trim() && (
          <section class={`doc${style ? ` doc--${style}` : ''}${style === 'periplus' && /^(Periplus|Sailing)/.test(page.title) ? ' doc--sea' : ''}`} aria-label={page.kind === 'artifact' ? 'Text' : 'Article'}>
            {page.kind === 'artifact' && a?.interlinear && <div class="doc__label">Commentary</div>}
            {page.kind === 'artifact' && !a?.interlinear && <div class="doc__label">{DOC_LABEL[style] ?? (style === 'stone' ? 'Text' : 'Translation')}</div>}
            <Html class="doc__body prose" html={bodyHtml} />
          </section>
        )}

        {place && <BookNav place={place} end />}

        {mobile && book && page.infobox.length > 0 && <Infobox page={page} label={label} inline />}

        {a?.ledger && <Ledger ledger={a.ledger} label={label} />}

        {page.accounts && page.accounts.sources.length > 0 && <AccountsTeaser page={page} label={label} />}

        {page.language && <LanguagePanel page={page} lang={page.language} label={label} />}

        {page.kind === 'polity' && <PolityDynasties polity={page.id} />}
        {page.kind === 'person' && <PersonHouse person={page.id} />}

        <LinkLists page={page} />
      </div>

      {hasAside && <div class="reader__aside">
        {page.kind === 'polity' && <Territory page={page} />}
        {!mobile && page.infobox.length > 0 && <Infobox page={page} label={label} />}
        {page.series && page.series.length > 0 && (
          <section class="aside-sect">
            <h2 class="sect">Over time</h2>
            {page.series.map((s) => <Sparkline series={s} />)}
          </section>
        )}
        {page.names && page.names.length > 0 && <Names names={page.names} />}
      </div>}
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

/** A year that opens the year view (dates before AY 0 stay plain). */
export function YearLink({ y }: { y: number }) {
  if (y < 0 || y > 5000) return <>{fmtYear(y)}</>;
  return <a class="ylink" href={`#/year/${y}`}>{fmtYear(y)}</a>;
}
function YearSpan({ t0, t1 }: { t0: number; t1: number }) {
  if (t0 === t1) return <YearLink y={t0} />;
  if (t1 >= 5000) return <><YearLink y={t0} /> – present</>;
  if (t0 < 0) return <><YearLink y={t0} /> – <YearLink y={t1} /></>;
  return <><a class="ylink" href={`#/year/${t0}`}>{t0}</a>–<a class="ylink" href={`#/year/${t1}`}>{t1}</a> AY</>;
}

/** Share this view. A flagship shares its static reading page (`path`, relative to the site root), whose
 *  social card shows the document; anything else shares the atlas link. */
export function ShareButton({ title, hash, path }: { title: string; hash?: string; path?: string }) {
  const [done, setDone] = useState(false);
  const share = async () => {
    const page = location.href.replace(/#.*$/, '');
    const url = path ? page.replace(/[?].*$/, '').replace(/[^/]*$/, '') + path : hash ? page + hash : location.href;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title, url });
      else { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 1600); }
    } catch { /* cancelled */ }
  };
  return <button class="btn btn--ghost" onClick={share}>{done ? 'Link copied' : 'Share'}</button>;
}

/** "‹ previous · Chapter N of M · next ›" for a page in an ordered collection; at the end, the next chapter
 *  as a call to read on (and, after the History's last chapter, the EPUB). */
function BookNav({ place: { c, i }, end = false }: { place: Place; end?: boolean }) {
  const hist = c.id === 'history';
  const prev = c.items[i - 1], next = c.items[i + 1];
  const name = (j: number) => (hist ? partName(c, j) : c.items[j].title);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    // reaching the end of a chapter marks it read
    if (!end || !hist || !ref.current) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) markDone(c.items[i].id); });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [c, i, end]);
  const part = partName(c, i);
  const here = hist ? (part.startsWith('Chapter') ? `${part} of ${chapterCount(c)}` : part) : `${c.title}, ${part}`;
  const epub = end && hist && !next ? readerDownload(meta.value) : undefined;
  return (
    <nav ref={ref} class={`booknav${end ? ' booknav--end' : ''}`} aria-label={`${c.title}: ${end ? 'read on' : 'chapters'}`}>
      {end && next && (
        <a class="booknav__on" href={`#/p/${next.id}`}>
          <span class="booknav__dir">Next{hist ? ` · ${partName(c, i + 1)}` : ''}</span>
          <span class="booknav__title">{next.title} →</span>
        </a>
      )}
      {end && !next && (
        <div class="booknav__fin">
          <p>{hist ? `The end of ${c.title}.` : `The last of ${c.items.length} in ${c.title}.`}</p>
          {epub && <a class="btn btn--accent" href={hrefOf(epub)} download>Take the whole book with you <span class="nowrap">· EPUB, {fmtBytes(epub.bytes)}</span></a>}
        </div>
      )}
      <div class="booknav__row">
        {prev ? <a class="booknav__prev" href={`#/p/${prev.id}`} rel="prev"><span class="booknav__dir">‹ Previous</span><span class="booknav__t">{name(i - 1)}</span></a> : <span />}
        <a class="booknav__here" href={`#/collections/${c.id}`} aria-label={`${here}: contents`}>{hist ? here : <>{c.title}<br /><span class="nowrap">{part}</span></>}</a>
        {next ? <a class="booknav__next" href={`#/p/${next.id}`} rel="next"><span class="booknav__dir">Next ›</span><span class="booknav__t">{name(i + 1)}</span></a> : <span />}
      </div>
    </nav>
  );
}

/** A small in-page table of contents from the document's ## headings. */
function Contents({ heads }: { heads: string[] }) {
  const go = (k: number) => {
    const el = document.getElementById(`sec-${k + 1}`);
    if (!el) return;
    el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
  };
  return (
    <nav class="toc" aria-label="Contents">
      <details open={!isMobile.peek()}>
        <summary>Contents <span class="muted">· {heads.length} sections</span></summary>
        <ol>{heads.map((h, k) => <li><button class="linkish" onClick={() => go(k)}>{h}</button></li>)}</ol>
      </details>
    </nav>
  );
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

function Interlinear({ it, label }: { it: NonNullable<NonNullable<PageJson['artifact']>['interlinear']>; label: (id: string) => string | undefined }) {
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
          <Html tag="blockquote" class="stele__trans" html={`“${inline(it.translation, label)}”`} />
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
              <tr>{r.map((c, i) => (numeric[i] || !c.includes('[[') ? <td class={numeric[i] ? 'r num' : ''}>{c}</td> : <td dangerouslySetInnerHTML={{ __html: inline(c, label) }} />))}</tr>
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

const STAGE_COLORS = ['#8e2f1f', '#b5683a', '#a88a3a', '#5f7f45', '#3e7a86', '#4d5f9a', '#7a4f8f', '#9a4a6a'];

function LanguagePanel({ page, lang, label }: { page: PageJson; lang: NonNullable<PageJson['language']>; label: (id: string) => string | undefined }) {
  // ?sc=<year>&law=<label> (from the Word Machine): open the full list at that dated law
  const sc = route.value.params.get('sc'), law = route.value.params.get('law');
  const [all, setAll] = useState(!!sc);
  useEffect(() => {
    if (!sc) return;
    setAll(true);
    requestAnimationFrame(() => {
      const el = [...document.querySelectorAll<HTMLElement>(`.sctl__item[data-y="${sc}"]`)].find((e) => !law || e.dataset.l === law);
      if (el) { el.classList.add('is-hl'); el.scrollIntoView({ block: 'center' }); }
    });
  }, [sc, law, page.id]);
  const changes = useMemo(() => lang.soundChanges.slice().sort((a, b) => a.year - b.year), [lang]);
  // name -> id for languages linked from this page (body links carry the short names)
  const nameToId = useMemo(() => {
    const m = new Map<string, string>();
    for (const mm of page.body.matchAll(/\[\[(lan:\d+)\|([^\]]+)\]\]/g)) m.set(mm[2], mm[1]);
    for (const [id, t] of Object.entries(page.labels ?? {})) if (id.startsWith('lan:')) { m.set(t, id); m.set(t.replace(/ language$/, ''), id); }
    return m;
  }, [page]);
  // lineage = the languages the changes happened in, oldest first
  const stages = useMemo(() => {
    const out: { name: string; id?: string; from: number; changes: typeof changes }[] = [];
    for (const c of changes) {
      let st = out.find((x) => x.name === c.lang);
      if (!st) { st = { name: c.lang, id: nameToId.get(c.lang), from: c.year, changes: [] }; out.push(st); }
      st.changes.push(c);
    }
    return out;
  }, [changes, nameToId]);
  const ownName = page.title.replace(/ language$/, '');
  const shown = all ? stages : null;
  return (
    <section class="langpanel">
      <FamilyTree page={page} lang={lang} label={label} stages={stages} ownName={ownName} />

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
                          <span class="wf" title={fmtYear(yy)}><i>{f}</i><small>{yy < 0 ? `${-yy} BAY` : yy}</small></span>
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
          <h2 class="sect">Sound changes <span class="muted small">({changes.length}, inherited and own)</span></h2>
          <SoundStrip stages={stages} end={Math.min(5000, page.t1)} />
          <ol class="sctl">
            {(shown ?? stages).map((st, si) => {
              const items = all ? st.changes : st.changes.slice(-Math.max(2, Math.ceil(14 / stages.length)));
              const hidden = st.changes.length - items.length;
              return (
                <li class="sctl__stage" style={{ '--stage': STAGE_COLORS[si % STAGE_COLORS.length] }}>
                  <div class="sctl__head">
                    <span class="sctl__dot" aria-hidden="true" />
                    {st.id && st.id !== page.id ? <a href={`#/p/${st.id}`}>{st.name}</a> : <strong>{st.name}</strong>}
                    <span class="muted small">{st.name === ownName ? 'this language' : si === 0 ? 'ancestor · proto-language' : 'ancestor'} · {st.changes.length} change{st.changes.length === 1 ? '' : 's'} from {fmtYear(st.from)}</span>
                  </div>
                  <ol class="sctl__items">
                    {hidden > 0 && <li class="sctl__more muted small">… {hidden} earlier change{hidden === 1 ? '' : 's'}</li>}
                    {items.map((c) => (
                      <li class="sctl__item" data-y={c.year} data-l={c.label}>
                        <span class="sctl__y">{c.year < 0 ? `${-c.year} BAY` : c.year}</span>
                        <span class="sctl__l">{c.label}</span>
                        <code class="sctl__r">{c.rule}</code>
                      </li>
                    ))}
                  </ol>
                </li>
              );
            })}
          </ol>
          <button class="btn btn--ghost" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${changes.length} changes`}</button>
          <p class="muted small sctl__key">BAY = years before AY 0. Rules read <code>input &gt; output / environment</code>; <code>V</code> vowel, <code>C</code> consonant, <code>#</code> word edge, <code>∅</code> loss.</p>
        </>
      )}
    </section>
  );
}

function SoundStrip({ stages, end }: { stages: { name: string; from: number; changes: { year: number; rule: string; label: string }[] }[]; end: number }) {
  if (!stages.length) return null;
  const first = stages[0].from;
  const x0 = Math.floor((first - 100) / 100) * 100, x1 = Math.max(end, stages[stages.length - 1].changes.at(-1)!.year + 50);
  const W = 800, H = 58;
  const X = (y: number) => ((y - x0) / Math.max(1, x1 - x0)) * W;
  return (
    <svg class="sstrip" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Sound changes from ${fmtYear(first)} to ${fmtYear(x1)}`}>
      {stages.map((st, i) => {
        const a = X(st.from), b = i + 1 < stages.length ? X(stages[i + 1].from) : W;
        const c = STAGE_COLORS[i % STAGE_COLORS.length];
        return (
          <g>
            <rect x={a} y={22} width={Math.max(1, b - a)} height={10} fill={c} opacity="0.22" />
            {st.changes.map((ch) => <line x1={X(ch.year)} x2={X(ch.year)} y1={12} y2={42} stroke={c} stroke-width="2" vector-effect="non-scaling-stroke"><title>{`${fmtYear(ch.year)} · ${st.name}: ${ch.label} (${ch.rule})`}</title></line>)}
          </g>
        );
      })}
      {x0 < 0 && <line class="sstrip__zero" x1={X(0)} x2={X(0)} y1={4} y2={50} vector-effect="non-scaling-stroke" />}
    </svg>
  );
}

function FamilyTree({ page, lang, label, stages, ownName }: {
  page: PageJson; lang: NonNullable<PageJson['language']>; label: (id: string) => string | undefined;
  stages: { name: string; id?: string }[]; ownName: string;
}) {
  const parent = usePage(lang.parent);
  const siblings = parent.page?.language?.daughters.filter((d) => d !== page.id) ?? [];
  const sibLabel = (id: string) => parent.page?.labels?.[id] ?? titleOf(id) ?? id;
  // ancestors: lineage stages before this language (oldest first); make sure the parent is last
  const ancestors = stages.filter((s) => s.name !== ownName).map((s) => ({ id: s.id, name: s.name }));
  if (lang.parent && !ancestors.some((a) => a.id === lang.parent)) ancestors.push({ id: lang.parent, name: label(lang.parent) ?? lang.parent });
  const SIB = 8;
  const self = (
    <li class="ftree__self">
      <span class="ftree__node is-self">{page.title}</span>
      {lang.daughters.length > 0 && (
        <ol>
          {lang.daughters.map((d) => <li><a class="ftree__node" href={`#/p/${d}`}>{label(d) ?? d}</a></li>)}
        </ol>
      )}
    </li>
  );
  let tree = (
    <ol>
      {siblings.slice(0, Math.ceil(SIB / 2)).map((d) => <li><a class="ftree__node is-sib" href={`#/p/${d}`}>{sibLabel(d)}</a></li>)}
      {self}
      {siblings.slice(Math.ceil(SIB / 2), SIB).map((d) => <li><a class="ftree__node is-sib" href={`#/p/${d}`}>{sibLabel(d)}</a></li>)}
      {siblings.length > SIB && <li class="muted small">+ {siblings.length - SIB} more</li>}
    </ol>
  );
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    tree = (
      <ol>
        <li>
          {a.id ? <a class={`ftree__node${i === 0 ? ' is-root' : ''}`} href={`#/p/${a.id}`}>{a.name}</a> : <span class="ftree__node">{a.name}</span>}
          {i === 0 && <span class="ftree__tag">proto</span>}
          {tree}
        </li>
      </ol>
    );
  }
  return (
    <div class="ftree" aria-label="Family tree">
      <h2 class="sect">Family tree</h2>
      {ancestors.length === 0 && lang.daughters.length === 0 && siblings.length === 0 ? <p class="muted small">An isolate: no recorded relatives.</p> : <div class="ftree__body">{tree}</div>}
    </div>
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
