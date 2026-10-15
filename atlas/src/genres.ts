// Per-genre reshaping of rendered document HTML, for layouts that Markdown alone cannot express.
// Each transform degrades to the plain rendering when a line does not have the expected shape
// (lacunae can eat the punctuation it relies on).

/** Put the document itself in a frame (`cls`) and leave the modern editorial note after it outside. */
function frame(html: string, cls: string): string {
  const at = html.search(/<hr>\s*<p><strong>Editorial note/);
  const cut = at < 0 ? html.length : at;
  return `<div class="${cls}">${html.slice(0, cut)}</div>${html.slice(cut)}`;
}

/** Omen tablet: "If <sign>: <outcome>. It is the omen of <whom>." as sign / outcome / precedent. */
function omen(html: string): string {
  let n = 0;
  html = html.replace(/<li>([\s\S]*?)<\/li>/g, (m, li: string) => {
    const w = li.indexOf(' It is the omen of ');
    let c = li.indexOf(': ');
    if (w >= 0 && c > w) c = -1;
    if (c < 0 && w < 0) return m;
    n++;
    const who = w < 0 ? '' : `<span class="om-who">${li.slice(w + 1)}</span>`;
    // a lacuna that ate the colon leaves sign and outcome run together across both columns
    if (c < 0) return `<li><span class="om-if om-lost">${li.slice(0, w)}</span>${who}</li>`;
    return `<li><span class="om-if">${li.slice(0, c)}</span><span class="om-then">${w < 0 ? li.slice(c + 2) : li.slice(c + 2, w)}</span>${who}</li>`;
  });
  if (n) html = html.replace('<ol', '<div class="om-head" aria-hidden="true"><span>Sign</span><span>Outcome</span></div><ol');
  return frame(html, 'clay');
}

/** Itinerary: each "**N. To X.** distance, time. …" paragraph becomes a stage on a route line. */
function periplus(html: string): string {
  html = html.replace(/<p><strong>(\d+\.[^]*?)<\/strong>\s*([^<]*?\.)(?=\s|<\/p>)/g,
    (_m, head: string, leg: string) => `<p class="stage"><strong>${head}</strong> <span class="leg">${leg}</span>`);
  const last = html.lastIndexOf('<p class="stage">');
  if (last >= 0) html = `${html.slice(0, last)}<p class="stage stage--end">${html.slice(last + 17)}`;
  return frame(html, 'route');
}

/** Customs tariff: the schedule as a posted board; free goods marked. */
function tariff(html: string): string {
  return frame(html.replace(/(<td[^>]*)>(free)<\/td>/g, '$1 data-free>$2</td>'), 'posted');
}

export const GENRE_HTML: Record<string, (html: string) => string> = { omen, periplus, tariff };

/** Give every h2 an id for the in-page contents, and collect their text. */
export function sections(html: string): { html: string; heads: string[] } {
  const heads: string[] = [];
  html = html.replace(/<h2>([\s\S]*?)<\/h2>/g, (_m, inner: string) => {
    heads.push(inner.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    return `<h2 id="sec-${heads.length}" tabindex="-1">${inner}</h2>`;
  });
  return { html, heads };
}

/** Words in a Markdown body (link targets dropped), for a reading-time estimate. */
export function wordCount(md: string): number {
  return md.replace(/\[\[[^\]|]+\|([^\]]*)\]\]/g, '$1').split(/\s+/).filter(Boolean).length;
}
