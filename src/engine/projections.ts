import type { ColFile, Point } from '../../schemas';
import { COL_CATEGORY_KEYS } from '../../schemas';

/** Compound annual growth rate over the last `years` of a series (or the whole series if shorter). */
export function cagr(series: Point[], years = 10): number {
  const s = [...series].sort((a, b) => a.year - b.year).filter((p) => p.value > 0);
  if (s.length < 2) return 0;
  const last = s[s.length - 1]!;
  const first = s.find((p) => p.year >= last.year - years) ?? s[0]!;
  const span = last.year - first.year;
  if (span <= 0) return 0;
  return Math.pow(last.value / first.value, 1 / span) - 1;
}

/** Points after the last historical year, for `horizonYears` years, compounding at `rate`. */
export function projectSeries(series: Point[], horizonYears: number, rate: number): Point[] {
  const s = [...series].sort((a, b) => a.year - b.year);
  const last = s[s.length - 1];
  if (!last) return [];
  const out: Point[] = [];
  let v = last.value;
  for (let i = 1; i <= horizonYears; i++) {
    v *= 1 + rate;
    out.push({ year: last.year + i, value: v });
  }
  return out;
}

export interface ColYear {
  year: number;
  /** Annual, local currency. */
  categories: Record<(typeof COL_CATEGORY_KEYS)[number], number>;
  total: number;
}

/** Inflate the family-of-4 basket from its base year for `horizonYears` years at the file's CPI. */
export function projectCol(col: ColFile, horizonYears: number): ColYear[] {
  const out: ColYear[] = [];
  for (let i = 0; i <= horizonYears; i++) {
    const f = Math.pow(1 + col.inflation.cpi_assumed, i);
    const categories = Object.fromEntries(COL_CATEGORY_KEYS.map((k) => [k, col.categories[k].value * f])) as ColYear['categories'];
    out.push({ year: col.base_year + i, categories, total: Object.values(categories).reduce((a, b) => a + b, 0) });
  }
  return out;
}
