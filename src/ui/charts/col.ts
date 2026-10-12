import type { EChartsCoreOption } from 'echarts/core';
import type { ColFile, CountryCode } from '../../../schemas';
import { COL_CATEGORY_KEYS } from '../../../schemas';
import { projectCol } from '../../engine/projections';
import { usdCompact } from '../format';
import { baseOption, chrome } from './theme';

export const COL_LABEL: Record<(typeof COL_CATEGORY_KEYS)[number], string> = {
  housing_rent: 'Housing (rent)', food: 'Food', transport: 'Transport', childcare_education: 'Childcare & education',
  healthcare: 'Healthcare', utilities: 'Utilities', other: 'Other',
};

export interface ColBar { country: CountryCode; city: string; year: number; categoriesUsd: Record<string, number>; totalUsd: number; incomeUsd?: number }

export function colBars(col: Partial<Record<CountryCode, ColFile>>, fx: (c: CountryCode) => number, countries: CountryCode[], yearsAhead: number): ColBar[] {
  const out: ColBar[] = [];
  for (const code of countries) {
    const f = col[code];
    if (!f) continue;
    const p = projectCol(f, yearsAhead).at(-1)!;
    const r = fx(code);
    const categoriesUsd = Object.fromEntries(COL_CATEGORY_KEYS.map((k) => [k, p.categories[k] / r]));
    const inf = Math.pow(1 + f.inflation.cpi_assumed, yearsAhead);
    out.push({
      country: code, city: f.city, year: p.year, categoriesUsd, totalUsd: p.total / r,
      incomeUsd: f.median_household_income ? (f.median_household_income.value * inf) / r : undefined,
    });
  }
  return out;
}

/** Stacked annual spend per country (USD) with a marker for median household income where known. */
export function colOption(bars: ColBar[], names: Record<CountryCode, string>): EChartsCoreOption {
  const b = baseOption();
  const c = chrome();
  const series: Record<string, unknown>[] = COL_CATEGORY_KEYS.map((k, i) => ({
    id: k, name: COL_LABEL[k], type: 'bar', stack: 'col', barMaxWidth: 36,
    itemStyle: { color: c.series[i], borderColor: c.surface, borderWidth: 1 },
    emphasis: { focus: 'series' },
    data: bars.map((x) => ({ value: Math.round(x.categoriesUsd[k] ?? 0), meta: { country: x.country } })),
  }));
  if (bars.some((x) => x.incomeUsd !== undefined)) {
    series.push({
      id: 'income', name: 'Median household income', type: 'scatter', symbol: 'diamond', symbolSize: 12,
      itemStyle: { color: c.ink, borderColor: c.surface, borderWidth: 2 },
      data: bars.map((x) => (x.incomeUsd === undefined ? null : Math.round(x.incomeUsd))),
      z: 10,
    });
  }
  return {
    ...b,
    tooltip: { ...b.tooltip, axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => (v == null ? '—' : usdCompact(v)) },
    xAxis: { type: 'category', data: bars.map((x) => `${names[x.country]}\n${x.city}`), ...b.axisStyle, splitLine: { show: false }, axisLabel: { ...b.axisStyle.axisLabel, interval: 0, fontSize: 11 } },
    yAxis: { type: 'value', ...b.axisStyle, axisLine: { show: false }, axisLabel: { ...b.axisStyle.axisLabel, formatter: (v: number) => usdCompact(v) } },
    series,
  };
}
