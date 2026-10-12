import { describe, expect, it } from 'vitest';
import type { ColFile } from '../../../schemas';
import { cagr, projectCol, projectSeries } from '../projections';

describe('projections', () => {
  it('cagr over the last 10 years', () => {
    const s = Array.from({ length: 21 }, (_, i) => ({ year: 2000 + i, value: 100 * Math.pow(1.03, i) }));
    expect(cagr(s)).toBeCloseTo(0.03, 10);
    expect(cagr([{ year: 2020, value: 1 }])).toBe(0);
    expect(cagr([])).toBe(0);
  });
  it('projects forward from the last year', () => {
    const p = projectSeries([{ year: 2023, value: 100 }, { year: 2024, value: 110 }], 3, 0.1);
    expect(p.map((x) => x.year)).toEqual([2025, 2026, 2027]);
    expect(p[2]!.value).toBeCloseTo(110 * 1.331, 6);
    expect(projectSeries([], 3, 0.1)).toEqual([]);
  });
  it('inflates the cost-of-living basket', () => {
    const meta = { source: 'https://example.org', last_verified: '2026-01-01' };
    const v = (value: number) => ({ value, meta });
    const col: ColFile = {
      country: 'au', household: '2 adults + 2 children', city: 'Sydney', currency: 'AUD', base_year: 2025,
      categories: { housing_rent: v(50_000), food: v(15_000), transport: v(8000), childcare_education: v(10_000), healthcare: v(4000), utilities: v(4000), other: v(9000) },
      inflation: { cpi_assumed: 0.03, meta }, meta,
    };
    const p = projectCol(col, 2);
    expect(p).toHaveLength(3);
    expect(p[0]!.total).toBe(100_000);
    expect(p[2]!.total).toBeCloseTo(100_000 * 1.0609, 6);
    expect(p[2]!.year).toBe(2027);
  });
});
