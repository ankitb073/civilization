import { useEffect, useState } from 'preact/hooks';
import type { PageJson } from '../../../engine/src/export/contract.ts';
import { loadPage } from '../data.ts';
import { fmtSpan, subLabel } from '../format.ts';
import { KIND_LABEL } from '../kinds.ts';
import { inline } from '../md.ts';
import { setYear } from '../state.ts';
import { titleOf } from '../store.ts';

export function usePage(id: string | null): { page: PageJson | null; loading: boolean; missing: boolean } {
  const [st, setSt] = useState<{ id: string | null; page: PageJson | null; loading: boolean }>({ id: null, page: null, loading: false });
  useEffect(() => {
    if (!id) { setSt({ id: null, page: null, loading: false }); return; }
    let live = true;
    setSt({ id, page: null, loading: true });
    loadPage(id).then((p) => { if (live) setSt({ id, page: p, loading: false }); }).catch(() => { if (live) setSt({ id, page: null, loading: false }); });
    return () => { live = false; };
  }, [id]);
  return { page: st.id === id ? st.page : null, loading: st.loading || st.id !== id, missing: !st.loading && st.id === id && !st.page };
}

export function Eyebrow({ kind, sub }: { kind: string; sub?: string }) {
  const k = (KIND_LABEL as Record<string, [string, string]>)[kind]?.[0] ?? kind;
  return (
    <div class="eyebrow">
      <span class={`kdot k-${kind}`} aria-hidden="true" />
      {k}{sub && sub !== kind ? <> · {subLabel(sub)}</> : null}
    </div>
  );
}

export function Html({ html, class: cls, tag = 'div' }: { html: string; class?: string; tag?: 'div' | 'span' | 'dd' | 'p' }) {
  const T = tag as 'div';
  return <T class={cls} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function PageCard({ id, compact = false }: { id: string; compact?: boolean }) {
  const { page, loading, missing } = usePage(id);
  if (loading) return <div class="card card--loading"><div class="skel skel--t" /><div class="skel" /><div class="skel skel--s" /></div>;
  if (missing || !page) return <div class="card"><p class="muted">No archive page for this entry.</p></div>;
  const rows = page.infobox.slice(0, compact ? 4 : 7);
  return (
    <div class="card pagecard">
      <Eyebrow kind={page.kind} sub={page.sub} />
      <h2 class="pagecard__title"><a href={`#/p/${page.id}`}>{page.title}</a></h2>
      <div class="pagecard__span">{fmtSpan(page.t0, page.t1)}</div>
      {page.summary && <Html tag="p" class="pagecard__summary" html={inline(page.summary, (id) => page.labels?.[id] ?? titleOf(id))} />}
      {rows.length > 0 && (
        <dl class="kv">
          {rows.map(([k, v]) => (
            <>
              <dt>{k}</dt>
              <Html tag="dd" html={inline(v, (id) => page.labels?.[id] ?? titleOf(id))} />
            </>
          ))}
        </dl>
      )}
      <div class="actions">
        <a class="btn" href={`#/p/${page.id}`}>Read page</a>
        {page.accounts && page.accounts.sources.length > 1 && <a class="btn btn--accent" href={`#/compare/${page.id}`}>Compare accounts</a>}
        {page.kind === 'event' && <button class="btn btn--ghost" onClick={() => setYear(page.t0)}>Go to {page.t0}</button>}
        <a class="btn btn--ghost" href={`#/graph?focus=${encodeURIComponent(page.id)}&y=${page.t0}`}>Graph</a>
      </div>
    </div>
  );
}
