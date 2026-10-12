import type { EChartsCoreOption } from 'echarts/core';
import type { Asset, CountryCode } from '../../../schemas';
import type { Ledger } from '../../engine/types';
import { usdCompact } from '../format';
import { baseOption, chrome, countryColor } from './theme';

export interface NetworthSeriesMeta { country: CountryCode; asset: Asset }

/** Net value per country for one asset, plus one dashed untaxed benchmark (gross path of the first ledger). */
export function networthOption(ledgers: Ledger[], asset: Asset, names: Record<CountryCode, string>, compact = false): EChartsCoreOption {
  const b = baseOption();
  const c = chrome();
  const rows = ledgers.filter((l) => l.asset === asset);
  const labels = !compact && rows.length <= 4;
  const years = rows[0]?.rows.map((r) => r.year) ?? [];
  const series: Record<string, unknown>[] = rows.map((l) => ({
    id: JSON.stringify({ country: l.country, asset } satisfies NetworthSeriesMeta),
    name: names[l.country],
    type: 'line',
    data: l.rows.map((r) => Math.round(r.netValueUsd)),
    showSymbol: false,
    symbolSize: 8,
    lineStyle: { width: 2 },
    itemStyle: { color: countryColor(l.country) },
    emphasis: { focus: 'series', lineStyle: { width: 3 } },
    endLabel: labels ? { show: true, formatter: (p: { seriesName: string; value: number }) => `${p.seriesName} ${usdCompact(p.value)}`, color: c.ink2, fontSize: 11 } : undefined,
  }));
  const bench = rows[0];
  if (bench) {
    series.unshift({
      id: 'gross',
      name: 'No-tax benchmark',
      type: 'line',
      data: bench.rows.map((r) => Math.round(r.grossValueUsd)),
      showSymbol: false,
      silent: true,
      lineStyle: { width: 2, type: 'dashed', color: c.muted },
      itemStyle: { color: c.muted },
      emphasis: { disabled: true },
    });
  }
  return {
    ...b,
    tooltip: {
      ...b.tooltip,
      axisPointer: { type: 'cross', label: { backgroundColor: c.ink2 } },
      valueFormatter: (v: number) => usdCompact(v),
    },
    grid: { ...b.grid, right: labels ? 110 : 16 },
    xAxis: { type: 'category', data: years.map((y) => `Y${y}`), boundaryGap: false, ...b.axisStyle, splitLine: { show: false } },
    yAxis: { type: 'value', ...b.axisStyle, axisLine: { show: false }, axisLabel: { ...b.axisStyle.axisLabel, formatter: (v: number) => usdCompact(v) } },
    series,
  };
}
