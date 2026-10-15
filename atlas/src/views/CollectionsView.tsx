import { useEffect, useState } from 'preact/hooks';
import type { CollectionsJson } from '../../../engine/src/export/contract.ts';
import { itemHref, loadCollections } from '../extras.ts';
import { kindFromId } from '../kinds.ts';
import { SurpriseButton } from '../components/Surprise.tsx';

type Collection = CollectionsJson['collections'][number];

function useCollections(): CollectionsJson | null {
  const [c, setC] = useState<CollectionsJson | null>(null);
  useEffect(() => { loadCollections().then(setC).catch(() => {}); }, []);
  return c;
}

export function CollectionsView({ id }: { id: string | null }) {
  const data = useCollections();
  useEffect(() => { document.title = 'Collections — Palimpsest'; }, []);
  if (!data) return <div class="center-load"><div class="spinner" /> Opening the cabinets…</div>;
  if (id) {
    const c = data.collections.find((x) => x.id === id);
    if (!c) return <div class="collections"><h1 class="h-page">No such collection</h1><a href="#/collections">All collections</a></div>;
    return <CollectionPage c={c} />;
  }
  return (
    <div class="collections">
      <header class="collections__head">
        <div class="eyebrow">Curated from the archive</div>
        <h1 class="h-page">Collections</h1>
        <p class="collections__lede">Ways into {data.collections.reduce((s, c) => s + c.items.length, 0).toLocaleString('en-US')} pages, chosen by what makes them remarkable: the longest reigns, the deadliest plagues, the wars both sides wrote down.</p>
        <SurpriseButton label="Or open one at random" />
      </header>
      <div class="colgrid">
        {data.collections.map((c) => <CollectionCard c={c} />)}
      </div>
    </div>
  );
}

export function CollectionCard({ c, previews = 3 }: { c: Collection; previews?: number }) {
  return (
    <article class="colcard">
      <a class="colcard__t" href={`#/collections/${c.id}`}>{c.title}</a>
      <p class="colcard__b">{c.blurb}</p>
      <ul class="colcard__items">
        {c.items.slice(0, previews).map((it) => (
          <li><a href={itemHref(c.id, it.id)}><span class={`kdot k-${kindFromId(it.id) ?? 'artifact'}`} aria-hidden="true" />{it.title}</a><span class="colcard__y">{it.year}</span></li>
        ))}
      </ul>
      <a class="colcard__more" href={`#/collections/${c.id}`}>All {c.items.length} →</a>
    </article>
  );
}

function CollectionPage({ c }: { c: Collection }) {
  useEffect(() => { document.title = `${c.title} — Palimpsest`; }, [c]);
  const rival = c.id === 'rival';
  return (
    <div class="collections collections--one">
      <header class="collections__head">
        <a class="eyebrow" href="#/collections">← Collections</a>
        <h1 class="h-page">{c.title}</h1>
        <p class="collections__lede">{c.blurb}{rival ? ' Each opens side by side with the ground truth.' : ''}</p>
      </header>
      <ol class="colindex">
        {c.items.map((it, i) => (
          <li class="colindex__row">
            <span class="colindex__n">{i + 1}</span>
            <span class="colindex__y">{it.year < 0 ? `${-it.year} BAY` : `AY ${it.year}`}</span>
            <span class="colindex__main">
              <a class="colindex__t" href={itemHref(c.id, it.id)}><span class={`kdot k-${kindFromId(it.id) ?? 'artifact'}`} aria-hidden="true" />{it.title}</a>
              {it.note && <span class="colindex__note">{it.note}</span>}
            </span>
            {rival && <a class="colindex__alt" href={`#/p/${it.id}`}>event page</a>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A compact strip of selected collections for the landing panel. */
export function CollectionStrip({ ids }: { ids: string[] }) {
  const data = useCollections();
  if (!data) return null;
  const picks = ids.map((id) => data.collections.find((c) => c.id === id)).filter((c): c is Collection => !!c);
  if (!picks.length) return null;
  return (
    <section class="colstrip">
      <h3 class="sect">Collections</h3>
      {picks.map((c) => (
        <a class="colstrip__c" href={`#/collections/${c.id}`}>
          <span class="colstrip__t">{c.title}</span>
          <span class="colstrip__n">{c.items.length}</span>
          <span class="colstrip__b">{c.blurb}</span>
        </a>
      ))}
      <a class="linkish small" href="#/collections">All {data.collections.length} collections →</a>
    </section>
  );
}
