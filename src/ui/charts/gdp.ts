import type { EChartsCoreOption } from 'echarts/core';
import type { CountryCode, GdpFile } from '../../../schemas';
import { cagr, projectSeries } from '../../engine/projections';
import { usdCompact } from '../format';
import { baseOption, chrome } from './theme';

export interface GdpBar { country: CountryCode; now: number; nowYear: number; projected: number; projYear: number; cagr: number }

export function gdpBars(gdp: Partial<Record<CountryCode, GdpFile>>, countries: CountryCode[], horizon: number): GdpBar[] {
  const out: GdpBar[] = [];
  for (const code of countries) {
    const g = gdp[code];
    if (!g) continue;
    const last = [...g.series].sort((a, b) => a.year - b.year).at(-1)!;
    const rate = g.projection.method === 'manual' ? (g.projection.cagr ?? 0) : cagr(g.series);
    const proj = projectSeries(g.series, horizon, rate).at(-1)!;
    out.push({ country: code, now: last.value, nowYear: last.year, projected: proj.value, projYear: proj.year, cagr: rate });
  }
  return out;
}

/** GDP per capita today vs projected at the end of the horizon, grouped bars per country. */
export function gdpOption(bars: GdpBar[], names: Record<CountryCode, string>, horizon: number): EChartsCoreOption {
  const b = baseOption();
  const c = chrome();
  const mk = (id: string, name: string, slot: number, data: number[]) => ({
    id, name, type: 'bar', barMaxWidth: 28, barGap: '10%',
    itemStyle: { color: c.series[slot], borderRadius: [4, 4, 0, 0] },
    emphasis: { focus: 'series' },
    data: data.map((v, i) => ({ value: Math.round(v), meta: { country: bars[i]!.country } })),
  });
  return {
    ...b,
    tooltip: { ...b.tooltip, axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => usdCompact(v) },
    xAxis: { type: 'category', data: bars.map((x) => names[x.country]), ...b.axisStyle, splitLine: { show: false }, axisLabel: { ...b.axisStyle.axisLabel, interval: 0, fontSize: 11 } },
    yAxis: { type: 'value', ...b.axisStyle, axisLine: { show: false }, axisLabel: { ...b.axisStyle.axisLabel, formatter: (v: number) => usdCompact(v) } },
    series: [
      mk('now', `Latest (${bars[0]?.nowYear ?? ''})`, 0, bars.map((x) => x.now)),
      mk('proj', `Projected in ${horizon} years (trend)`, 1, bars.map((x) => x.projected)),
    ],
  };
}

/** Single-series history + projection line for the drill-down. */
export function gdpHistoryOption(g: GdpFile, horizon: number): EChartsCoreOption {
  const b = baseOption();
  const c = chrome();
  const hist = [...g.series].sort((a, b) => a.year - b.year);
  const rate = g.projection.method === 'manual' ? (g.projection.cagr ?? 0) : cagr(g.series);
  const proj = projectSeries(hist, horizon, rate);
  const years = [...hist.map((p) => p.year), ...proj.map((p) => p.year)];
  return {
    ...b,
    legend: { ...b.legend, show: true },
    tooltip: { ...b.tooltip, valueFormatter: (v: number) => (v == null ? '' : usdCompact(v)) },
    xAxis: { type: 'category', data: years, boundaryGap: false, ...b.axisStyle, splitLine: { show: false } },
    yAxis: { type: 'value', ...b.axisStyle, axisLine: { show: false }, axisLabel: { ...b.axisStyle.axisLabel, formatter: (v: number) => usdCompact(v) } },
    series: [
      { name: 'Historical', type: 'line', showSymbol: false, lineStyle: { width: 2 }, itemStyle: { color: c.series[0] }, data: [...hist.map((p) => Math.round(p.value)), ...proj.map(() => null)] },
      { name: 'Projected (trend)', type: 'line', showSymbol: false, lineStyle: { width: 2, type: 'dashed' }, itemStyle: { color: c.series[0] }, data: [...hist.map((_, i) => (i === hist.length - 1 ? Math.round(hist[i]!.value) : null)), ...proj.map((p) => Math.round(p.value))] },
    ],
  };
}
