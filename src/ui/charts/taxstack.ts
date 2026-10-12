import type { EChartsCoreOption } from 'echarts/core';
import type { CountryCode, Stage } from '../../../schemas';
import type { Ledger } from '../../engine/types';
import { ASSET_LABEL, STAGE_LABEL, usdCompact } from '../format';
import { baseOption, chrome, STAGE_SLOT } from './theme';

export interface TaxStackMeta { country: CountryCode; asset: Ledger['asset']; stage: Stage }

const parts = (ls: Ledger[]) => ls.filter((l) => l.asset !== 'portfolio');

const STAGES: Stage[] = ['ingress', 'growth', 'egress'];

/** Total tax by stage, one stacked bar per (country, asset). */
export function taxStackOption(all: Ledger[], names: Record<CountryCode, string>): EChartsCoreOption {
  const ledgers = parts(all);
  const b = baseOption();
  const c = chrome();
  const assets = [...new Set(ledgers.map((l) => l.asset))];
  const cats = ledgers.map((l) => (assets.length > 1 ? `${names[l.country]}\n${ASSET_LABEL[l.asset]}` : names[l.country]));
  const series = STAGES.map((stage) => ({
    id: stage,
    name: STAGE_LABEL[stage],
    type: 'bar',
    stack: 'tax',
    barMaxWidth: 36,
    itemStyle: { color: c.series[STAGE_SLOT[stage]], borderColor: c.surface, borderWidth: 1 },
    emphasis: { focus: 'self' },
    data: ledgers.map((l) => ({
      value: Math.round(l.totalsUsd.taxes[stage]),
      meta: { country: l.country, asset: l.asset, stage } satisfies TaxStackMeta,
    })),
  }));
  return {
    ...b,
    tooltip: {
      ...b.tooltip,
      axisPointer: { type: 'shadow' },
      valueFormatter: (v: number) => usdCompact(v),
    },
    xAxis: { type: 'category', data: cats, ...b.axisStyle, splitLine: { show: false }, axisLabel: { ...b.axisStyle.axisLabel, interval: 0, fontSize: 11 } },
    yAxis: { type: 'value', ...b.axisStyle, axisLine: { show: false }, axisLabel: { ...b.axisStyle.axisLabel, formatter: (v: number) => usdCompact(v) } },
    series,
  };
}
