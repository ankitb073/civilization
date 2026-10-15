// Reasons to come back: the History as a book on the landing panel, and a document of the day.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { PageJson } from '../../../engine/src/export/contract.ts';
import { loadPage } from '../data.ts';
import { plain } from '../md.ts';
import { ensureMeta, meta } from '../store.ts';
import { continueAt, docOfDay, historyBook, partName, progress, todayKey } from '../book.ts';
import { ShareButton } from '../views/PageView.tsx';

/** The History: "Start reading" or "Continue reading: Chapter 5 — <title>", with a progress bar. */
export function HistoryCard() {
  const c = historyBook();
  const p = progress.value;
  if (!c) return null;
  const cont = continueAt(c, p);
  const go = cont ?? { id: c.items[0].id, part: partName(c, 0), title: c.items[0].title };
  const done = p ? c.items.filter((it) => p.done.includes(it.id)).length : 0;
  return (
    <section class="bookcard" aria-labelledby="bookcard-t">
      <div class="bookcard__k">The History · {c.items.length} parts</div>
      <a class="bookcard__t" id="bookcard-t" href="#/collections/history">{c.title}</a>
      <a class="bookcard__go" href={`#/p/${go.id}`}>
        <span>{cont ? 'Continue reading' : 'Start reading'}</span>{go.part} — {go.title}
      </a>
      {done > 0 && (
        <div class="bookcard__bar" role="img" aria-label={`${done} of ${c.items.length} parts read`}>
          <span style={{ width: `${(done / c.items.length) * 100}%` }} />
        </div>
      )}
    </section>
  );
}

/** First line of a document's text, for a teaser; short verse lines are joined with " / ". */
function firstLine(md: string): string {
  const note = (l: string) => !l || /^\[[^\]]*\]\.?$/.test(l);
  const lines = (para: string) => para.split('\n').map((l) => plain(l).replace(/\s+/g, ' ').trim()).filter((l) => !note(l));
  // skip headings, tables, lists, short labels ("**I.**", "*Obverse.*") and bracketed notes ("*[Obverse.]*")
  const para = md.split(/\n\s*\n/).find((x) => !/^\s*(#|\||---|>|\d+\.\s)|^\s*(\*\*[^*]+\*\*|\*[^*]{1,24}\*)\s*$/.test(x) && lines(x).length) ?? '';
  let t = '';
  for (const l of lines(para)) {
    t = t ? `${t} / ${l}` : l;
    if (t.length > 70) break;
  }
  const s = /^(.{40,}?[.!?;])\s/.exec(t)?.[1] ?? t;
  return s.length > 180 ? `${s.slice(0, 176).replace(/\s+\S*$/, '')}…` : s;
}

/** Today in the archive: one flagship a day, picked from the viewer's local date (the same for everyone). */
export function TodayCard() {
  const m = meta.value;
  const id = m ? docOfDay(m) : null;
  const [page, setPage] = useState<PageJson | null>(null);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    // the page shard is the heaviest thing on the panel: fetch it only once the card is on screen
    if (!id || !ref.current) return;
    let live = true;
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      loadPage(id).then((pg) => { if (live) setPage(pg); }).catch(() => {});
    });
    io.observe(ref.current);
    return () => { live = false; io.disconnect(); };
  }, [id]);
  if (!id) return null;
  const date = (page?.artifact?.date ?? '').replace(/\s*\[AY \d+\]/, '');
  return (
    <section class="today" ref={ref} aria-labelledby="today-h">
      <h2 class="sect" id="today-h">Today in the archive <span class="today__day">{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}</span></h2>
      {page ? (
        <>
          <a class="today__t" href={`#/p/${id}`}>{page.title}</a>
          <div class="today__d">{date && !/^AY \d+$/.test(date) ? `${date} · ` : ''}AY {page.t0}</div>
          <p class="today__x">“{firstLine(page.body)}”</p>
          <div class="today__a">
            <a class="btn btn--accent" href={`#/p/${id}`}>Read today’s document</a>
            <ShareButton title={`Today in the archive: ${page.title}`} hash={`#/p/${id}`} />
          </div>
        </>
      ) : <div class="today__wait"><div class="skel skel--t" /><div class="skel" /></div>}
    </section>
  );
}

/** #/today (or #/today/YYYY-MM-DD): a bookmarkable address that opens the document of the day. */
export function TodayRedirect({ date }: { date: string | null }) {
  useEffect(() => {
    ensureMeta().then((m) => {
      const id = docOfDay(m, date && /^\d{4}-\d\d-\d\d$/.test(date) ? date : todayKey());
      location.replace(id ? `#/p/${id}` : '#/browse?kind=artifact&flag=1');
    }).catch(() => {});
  }, [date]);
  return <div class="center-load"><div class="spinner" /> Finding today’s document…</div>;
}
