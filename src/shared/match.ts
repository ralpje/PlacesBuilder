import type { PlacesItem } from './types.ts';

/** Lowercase, strip accents and punctuation, collapse spaces. "1.1  - ORY" -> "1.1 ory". */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\.(?=\s|$)/g, '')
    .trim();
}

/** Leading room code such as "8.1" or "4.10", if any. */
export function nameCode(s: string): string | undefined {
  return /^\s*(\d+(?:\.\d+)*)(?=\s|[-–:]|$)/.exec(s)?.[1];
}

/** The part of a name after its code: "8.1 - Casablanca" -> "casablanca". */
export function nameWithoutCode(s: string): string {
  const n = normalizeName(s);
  const code = nameCode(n);
  return code ? n.slice(code.length).trim() : n;
}

function bigrams(s: string): Map<string, number> {
  const t = s.replace(/\s+/g, ' ');
  const m = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice coefficient on character bigrams, 0..1. */
export function dice(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let overlap = 0;
  for (const [g, n] of A) overlap += Math.min(n, B.get(g) ?? 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

/** How well a label read off the plan matches a Places display name, 0..1. */
export function similarity(label: string, placesName: string): number {
  const a = normalizeName(label);
  const b = normalizeName(placesName);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const codeA = nameCode(a);
  const codeB = nameCode(b);
  if (codeA && codeB && codeA === codeB) return 0.95;
  const restA = nameWithoutCode(label);
  const restB = nameWithoutCode(placesName);
  if (restA && restA === restB) return 0.97;
  return Math.max(dice(a, b), dice(restA, restB) * 0.95);
}

export interface Suggestion {
  item: PlacesItem;
  score: number;
}

/** Best Places candidates for a label, best first. Items in `taken` are skipped. */
export function suggest(
  label: string,
  items: PlacesItem[],
  taken: ReadonlySet<string> = new Set(),
  min = 0.6,
  limit = 3,
): Suggestion[] {
  if (!label.trim()) return [];
  return items
    .filter((i) => !taken.has(i.placeId))
    .map((item) => ({ item, score: similarity(label, item.name) }))
    .filter((s) => s.score >= min)
    .sort((x, y) => y.score - x.score || x.item.name.localeCompare(y.item.name))
    .slice(0, limit);
}
