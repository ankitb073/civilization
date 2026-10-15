// Minimal Markdown renderer for archive pages: headings, paragraphs, lists, blockquotes,
// tables, rules, emphasis, code, external links, and [[id|text]] WikiLinks.

import { kindFromId } from './kinds.ts';

export type TitleLookup = (id: string) => string | undefined;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function inline(src: string, title: TitleLookup = () => undefined): string {
  // Protect wiki links and code spans before escaping.
  const tokens: string[] = [];
  const stash = (html: string) => `\u0000${tokens.push(html) - 1}\u0000`;
  let s = src.replace(/\[\[([a-z]{3}:[^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, id: string, text?: string) => {
    const k = kindFromId(id) ?? 'x';
    const label = text ?? title(id) ?? id;
    return stash(`<a class="wl k-${k}" href="#/p/${esc(id)}" data-id="${esc(id)}">${esc(label)}</a>`);
  });
  s = s.replace(/`([^`]+)`/g, (_m, c: string) => stash(`<code>${esc(c)}</code>`));
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, t: string, u: string) => stash(`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>`));
  s = esc(s);
  s = s.replace(/\[(\.\.\.|…|x(?: x)*)\]/g, '<span class="lac" title="lacuna — text lost">[$1]</span>');
  // ~~error~~ correction  → struck-through error followed by the correction (school exercises)
  s = s.replace(/~~([^~]+)~~(\s+)(\u0000\d+\u0000|[^\s<,.;:]+)?/g, (_m, err: string, sp: string, corr?: string) =>
    `<del class="err">${err}</del>${sp}${corr ? `<ins class="corr">${corr}</ins>` : ''}`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s.,;:!?)]|$)/g, '$1<em>$2</em>');
  s = s.replace(/ {2,}\n|\\\n/g, '<br>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => tokens[Number(i)]);
  return s;
}

export function render(md: string, title: TitleLookup = () => undefined, opts: { breaks?: boolean } = {}): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  const isBlank = (l: string) => /^\s*$/.test(l);
  while (i < lines.length) {
    const l = lines[i];
    if (isBlank(l)) { i++; continue; }
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^(#{1,4})\s+(.*)$/))) {
      const lvl = Math.min(6, m[1].length + 1); // page h1 is the title
      out.push(`<h${lvl}>${inline(m[2], title)}</h${lvl}>`);
      i++;
      continue;
    }
    if (/^\s*(---+|\*\*\*+)\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(l)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      out.push(`<blockquote>${render(buf.join('\n'), title, opts)}</blockquote>`);
      continue;
    }
    if (/^\s*\|/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      // split on | but not inside [[id|text]] links
      const row = (r: string) => {
        const t = r.trim().replace(/^\|/, '').replace(/\|$/, '');
        const cells: string[] = [];
        let cur = '', depth = 0;
        for (let k = 0; k < t.length; k++) {
          if (t.startsWith('[[', k)) { depth++; cur += '[['; k++; continue; }
          if (t.startsWith(']]', k) && depth > 0) { depth--; cur += ']]'; k++; continue; }
          if (t[k] === '|' && depth === 0) { cells.push(cur.trim()); cur = ''; continue; }
          cur += t[k];
        }
        cells.push(cur.trim());
        return cells;
      };
      const head = row(l);
      const aligns = row(lines[i + 1]).map((c) => (c.endsWith(':') ? 'right' : ''));
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { body.push(row(lines[i])); i++; }
      const num = (c: string) => /^[−\-+]?[\d,.\s]+%?$/.test(c);
      const dash = (c: string) => /^[—–-]$/.test(c.trim()) || c.trim() === '';
      const total = (r: string[]) => /^\*\*(total|sum)/i.test(r[0] ?? '');
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map((h, k) => `<th${aligns[k] ? ` class="r"` : ''}>${inline(h, title)}</th>`).join('')}</tr></thead><tbody>${body
        .map((r) => `<tr${total(r) ? ' class="total"' : ''}>${r.map((c, k) => {
          const cls = [aligns[k] || num(c) ? 'r' : '', dash(c) ? 'dash' : ''].filter(Boolean).join(' ');
          return `<td${cls ? ` class="${cls}"` : ''} data-col="${esc(head[k] ?? '').replace(/\[\[[^\]|]+\|([^\]]*)\]\]/g, '$1')}">${inline(c, title)}</td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if ((m = l.match(/^\s*([-*+]|\d+[.)])\s+/))) {
      const ordered = /\d/.test(m[1]);
      const items: string[] = [];
      let start = 1;
      if (ordered) start = parseInt(m[1], 10) || 1;
      while (i < lines.length) {
        const li = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (!li || /\d/.test(li[1]) !== ordered) break;
        let text = li[2];
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) { text += ' ' + lines[i].trim(); i++; }
        items.push(`<li>${inline(text, title)}</li>`);
      }
      out.push(ordered ? `<ol${start !== 1 ? ` start="${start}"` : ''}>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && !isBlank(lines[i]) && !/^(#{1,4})\s|^\s*>|^\s*([-*+]|\d+[.)])\s+|^\s*\|/.test(lines[i]) && !/^\s*(---+)\s*$/.test(lines[i])) {
      buf.push(lines[i]);
      i++;
    }
    if (!buf.length) { buf.push(lines[i]); i++; }
    // verse keeps its line breaks; prose joins lines
    out.push(`<p>${inline(buf.join('\n'), title).replace(/\n/g, opts.breaks ? '<br>' : ' ')}</p>`);
  }
  return out.join('\n');
}

/** Strip markdown to plain text (for summaries and aria labels). */
export function plain(md: string): string {
  return md.replace(/\[\[[^\]|]+\|([^\]]*)\]\]/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/[*_`#>]/g, '').trim();
}
