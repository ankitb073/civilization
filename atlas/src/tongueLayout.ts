// The Tree of Tongues layout, shared by the Languages view and the Word Machine (both lazy chunks).

import type { Lang, LangIndex } from './languages.ts';

export interface Row { lang: Lang; row: number; parentRow: number }
export interface FamilyBlock { id: string; name: string; color: string; size: number; top: number; bottom: number }
export interface TreeLayout { rows: Row[]; blocks: FamilyBlock[]; total: number }

/** Lay out each family as a tree: later-born daughters sit closest to their parent so branches never cross a living line. */
export function layoutTongues(ix: LangIndex): TreeLayout {
  const kids = new Map<string, Lang[]>();
  for (const l of ix.data.languages) if (l.parent) { if (!kids.has(l.parent)) kids.set(l.parent, []); kids.get(l.parent)!.push(l); }
  const rows: Row[] = [];
  const blocks: FamilyBlock[] = [];
  let cursor = 1; // leave a row for the first family's label
  const order = (l: Lang): Lang[] => {
    const ks = (kids.get(l.id) ?? []).slice().sort((a, b) => b.born - a.born || a.id.localeCompare(b.id)); // latest first
    const above: Lang[] = [], below: Lang[] = [];
    ks.forEach((k, i) => (i % 2 === 0 ? above : below).push(k));
    above.reverse(); // farthest (earliest) at the top
    return [...above.flatMap(order), l, ...below.flatMap(order)];
  };
  for (const f of ix.families) {
    const root = ix.byId.get(f.id);
    if (!root) continue;
    const seq = order(root);
    const top = cursor;
    const at = new Map<string, number>();
    seq.forEach((l, i) => at.set(l.id, top + i));
    for (const l of seq) rows.push({ lang: l, row: at.get(l.id)!, parentRow: l.parent ? at.get(l.parent) ?? -1 : -1 });
    cursor += seq.length;
    blocks.push({ id: f.id, name: f.name, color: f.color, size: f.size, top, bottom: cursor - 1 });
    cursor += 2; // gap between families
  }
  // total counts the leading label row
  return { rows, blocks, total: cursor - 2 };
}

/** An era's name for the band over the chart ("Age of Iron" → "IRON"); it shows only where it fits (about 6.4 px a letter). */
export const bandName = (name: string) => name.replace(/^Age of (the )?/, '').toUpperCase();
