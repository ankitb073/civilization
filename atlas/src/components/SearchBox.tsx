import { useEffect, useRef, useState } from 'preact/hooks';
import { searchRank } from '../data.ts';
import { ensureSearch, searchIndex } from '../store.ts';
import { navigate } from '../state.ts';
import { KIND_LABEL } from '../kinds.ts';

export function SearchBox({ autoFocus = false, full = false, onDone }: { autoFocus?: boolean; full?: boolean; onDone?: () => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const idx = searchIndex.value;

  useEffect(() => { if (autoFocus) { inputRef.current?.focus(); ensureSearch().catch(() => {}); } }, [autoFocus]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    if (!full) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  const results = idx && q.trim() ? searchRank(idx, q, full ? 40 : 10) : [];
  const go = (i: number) => {
    if (!idx) return;
    navigate(`#/p/${idx.ids[i]}`);
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
    onDone?.();
  };
  return (
    <div class={`search${full ? ' search--full' : ''}`} role="combobox" aria-expanded={open && results.length > 0} aria-haspopup="listbox">
      <svg class="search__icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2" /><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
      <input
        ref={inputRef}
        class="search__input"
        type="search"
        placeholder={full ? 'Search people, places, wars, documents…' : 'Search the archive  /'}
        aria-label="Search the archive"
        aria-autocomplete="list"
        value={q}
        onFocus={() => { setOpen(true); ensureSearch().catch(() => {}); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onInput={(e) => { setQ((e.target as HTMLInputElement).value); setActive(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(results.length - 1, active + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, active - 1)); }
          else if (e.key === 'Enter' && results[active] !== undefined) { e.preventDefault(); go(results[active]); }
          else if (e.key === 'Escape') { (e.target as HTMLInputElement).blur(); }
        }}
      />
      {(open || full) && q.trim() && (
        <ul class="search__results" role="listbox">
          {!idx && <li class="search__empty">Loading index…</li>}
          {idx && results.length === 0 && <li class="search__empty">Nothing in the archive matches “{q}”.</li>}
          {idx && results.map((i, k) => (
            <li role="option" aria-selected={k === active}>
              <a class={`search__item${k === active ? ' is-active' : ''}`} href={`#/p/${idx.ids[i]}`} onMouseDown={(e) => { e.preventDefault(); go(i); }} onMouseEnter={() => setActive(k)}>
                <span class={`kdot k-${idx.kinds[i]}`} aria-hidden="true" />
                <span class="search__t">{idx.titles[i]}</span>
                <span class="search__m">{(KIND_LABEL as Record<string, [string, string]>)[idx.kinds[i]]?.[0]} · {idx.t0[i]}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
