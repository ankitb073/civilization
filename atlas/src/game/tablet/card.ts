// The share card: a 1200×630 image of your tablet with the line you would post, drawn in the browser so it can be
// saved or handed to the phone's share sheet along with the text and the link.

export interface CardText { kicker: string; headline: string; fate: string; squares: string; foot: string }

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (g.measureText(next).width > maxW && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export async function renderCard(tablet: HTMLCanvasElement | null, t: CardText): Promise<Blob | null> {
  try { await Promise.all([document.fonts.load('500 46px "EB Garamond Variable"'), document.fonts.load('italic 400 28px "EB Garamond Variable"'), document.fonts.load('600 16px "Inter Variable"')]); } catch { /* system fonts */ }
  const W = 1200, H = 630;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const bg = g.createRadialGradient(W * 0.72, H * 0.45, 40, W * 0.6, H * 0.5, W * 0.8);
  bg.addColorStop(0, '#4a2e18'); bg.addColorStop(0.55, '#24170e'); bg.addColorStop(1, '#120c08');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // the tablet, on the right, as large as it fits
  if (tablet && tablet.width > 0) {
    const maxW = 560, maxH = 560;
    const k = Math.min(maxW / tablet.width, maxH / tablet.height);
    const w = tablet.width * k, h = tablet.height * k;
    g.drawImage(tablet, W - 40 - w, (H - h) / 2 + 10, w, h);
  }
  const serif = '"EB Garamond Variable", "EB Garamond", Georgia, serif';
  const sans = '"Inter Variable", Inter, system-ui, sans-serif';
  const left = 64, textW = tablet ? 520 : 1060;
  g.fillStyle = '#d9b56a';
  g.font = `600 16px ${sans}`;
  g.letterSpacing = '3px';
  g.fillText(t.kicker.toUpperCase(), left, 82);
  g.letterSpacing = '0px';
  g.fillStyle = '#f3e7cf';
  let size = 48;
  let lines: string[] = [];
  for (; size >= 32; size -= 2) {
    g.font = `500 ${size}px ${serif}`;
    lines = wrap(g, t.headline, textW);
    if (lines.length * size * 1.12 <= 300) break;
  }
  let y = 140 + size * 0.4;
  for (const l of lines) { g.fillText(l, left, y); y += size * 1.12; }
  g.font = `italic 400 28px ${serif}`;
  g.fillStyle = '#e2c487';
  y += 18;
  for (const l of wrap(g, t.fate, textW)) { g.fillText(l, left, y); y += 34; }
  g.font = `30px ${sans}`;
  g.fillText(t.squares, left, Math.min(H - 92, y + 30));
  g.font = `500 16px ${sans}`;
  g.fillStyle = '#b9a586';
  g.fillText(t.foot, left, H - 48);
  return new Promise((ok) => c.toBlob((b) => ok(b), 'image/png'));
}
