export const YEAR_LABEL = 'AY';

export function fmtYear(y: number): string {
  return `${Math.round(y)} ${YEAR_LABEL}`;
}
export function fmtSpan(t0: number, t1: number, end = 5000): string {
  if (t0 === t1) return fmtYear(t0);
  if (t1 >= end) return `${t0} ${YEAR_LABEL} – present`;
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
export function subLabel(s: string): string {
  return cap(s.replace(/[-_]/g, ' '));
}
