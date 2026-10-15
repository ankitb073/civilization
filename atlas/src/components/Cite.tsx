import { useState } from 'preact/hooks';
import type { PageJson } from '../../../engine/src/export/contract.ts';
import { meta } from '../store.ts';

const SITE = 'https://ankitb073.github.io/civilization/';

export function citation(page: PageJson, label: (id: string) => string | undefined): { text: string; bibtex: string } {
  const a = page.artifact!;
  const m = meta.value;
  const world = `Palimpsest — the archive of ${m?.worldName ?? 'the world'} (seed ${m?.seed ?? '?'})`;
  const url = `${SITE}#/p/${page.id}`;
  // page labels carry disambiguators like "Nalilimi (translator, AY 4840–4905)": cite the bare name
  const bare = (x?: string) => x?.replace(/\s*\([^)]*\)\s*$/, '');
  const author = bare(a.authorId ? label(a.authorId) : undefined);
  const translator = bare(a.translatorId ? label(a.translatorId) : undefined);
  const who = translator ? `${author ? `${author}; ` : ''}${translator} (trans.)` : author ?? 'Anonymous';
  const text = `${who}, “${page.title}”, ${a.catalog}. In: ${world}. ${url}`;
  const key = a.catalog.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const esc = (s: string) => s.replace(/[{}]/g, '');
  const lines = [
    `@misc{${key},`,
    `  title        = {${esc(page.title)}},`,
    author ? `  author       = {${esc(author)}},` : null,
    translator ? `  translator   = {${esc(translator)}},` : null,
    `  howpublished = {${esc(world)}},`,
    `  note         = {${esc(a.catalog)}; AY ${page.t0}${a.date ? `; dated ${esc(a.date)}` : ''}},`,
    `  url          = {${url}}`,
    '}',
  ].filter(Boolean);
  return { text, bibtex: lines.join('\n') };
}

export function CiteButton({ page, label }: { page: PageJson; label: (id: string) => string | undefined }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const c = citation(page, label);
  const copy = async (what: 'text' | 'bibtex') => {
    try { await navigator.clipboard.writeText(c[what]); setCopied(what); setTimeout(() => setCopied(null), 1600); } catch { /* clipboard blocked */ }
  };
  return (
    <>
      <button class={`btn btn--ghost${open ? ' is-on' : ''}`} aria-expanded={open} aria-controls="cite-panel" onClick={() => setOpen(!open)}>Cite</button>
      {open && (
        <div class="cite" id="cite-panel" role="region" aria-label="Citation">
          <div class="cite__row">
            <div class="cite__h"><span class="sect">Citation</span><button class="btn btn--ghost" onClick={() => copy('text')}>{copied === 'text' ? 'Copied' : 'Copy'}</button></div>
            <p class="cite__text">{c.text}</p>
          </div>
          <div class="cite__row">
            <div class="cite__h"><span class="sect">BibTeX</span><button class="btn btn--ghost" onClick={() => copy('bibtex')}>{copied === 'bibtex' ? 'Copied' : 'Copy'}</button></div>
            <pre class="cite__bib">{c.bibtex}</pre>
          </div>
        </div>
      )}
    </>
  );
}
