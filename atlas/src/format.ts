export const YEAR_LABEL = 'AY';

export function fmtYear(y: number): string {
  const r = Math.round(y);
  return r < 0 ? `${-r} before ${YEAR_LABEL} 0` : `${r} ${YEAR_LABEL}`;
}
export function fmtSpan(t0: number, t1: number, end = 5000): string {
  if (t0 === t1) return fmtYear(t0);
  if (t1 >= end) return `${fmtYear(t0)} – present`;
  if (t0 < 0) return `${fmtYear(t0)} – ${fmtYear(t1)}`;
  return `${t0}–${t1} ${YEAR_LABEL}`;
}
export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}
export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  if (a >= 100 || Number.isInteger(n)) return `${Math.round(n)}`;
  return n.toFixed(a >= 10 ? 1 : 2);
}
export function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${Math.round(b / 1e3)} KB`;
  return `${b} B`;
}
export function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
/** Display names for sub-types whose raw key reads badly ("muster", "periplus"). Keyed "kind:sub" where the
 *  same key means different things in different kinds (a currency's "paper" vs an essay). */
const SUB_LABEL: Record<string, string> = {
  omen: 'Omen collection', periplus: 'Itinerary', tariff: 'Customs tariff', muster: 'Muster roll', story: 'Short story',
  exercise: 'School exercise', 'artifact:excavation': 'Excavation report', manifest: 'Harbour register', record: 'Record of calamity',
  market: 'Market report', debate: 'Assembly debate', yearbook: 'Statistical yearbook', 'artifact:paper': 'Essay',
  'artifact:coin': 'Coin issue', 'currency:paper': 'Paper money', 'currency:fiat': 'Fiat money', 'currency:weight': 'Weight standard',
  'city-state': 'City-state', 'one-party-state': 'One-party state', 'founding-city': 'City founding', 'climate:cold': 'Cold spell',
};
export function subLabel(s: string, kind?: string): string {
  return SUB_LABEL[`${kind}:${s}`] ?? SUB_LABEL[s] ?? cap(s.replace(/[-_]/g, ' '));
}
