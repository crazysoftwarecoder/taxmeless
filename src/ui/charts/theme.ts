import * as echarts from 'echarts/core';
import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { LabelLayout, LegacyGridContainLabel } from 'echarts/features';
import type { CountryCode } from '../../../schemas';

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, CanvasRenderer, LegacyGridContainLabel, LabelLayout]);
export { echarts };

/** Validated categorical palette (fixed order, light / dark steps). See CLAUDE.md → dataviz. */
export const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

/** Fixed colour slot per country: colour follows the entity, never its rank. */
export const COUNTRY_SLOT: Record<CountryCode, number> = { au: 0, us: 1, uk: 2, ca: 3, nz: 4, sg: 5, ae: 6, de: 7, ch: 0, in: 1 };

export const STAGE_SLOT = { ingress: 0, growth: 1, egress: 2 } as const;

export function isDark(): boolean {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export const chrome = () => (isDark()
  ? { surface: '#1a1a19', ink: '#f0efec', ink2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835', series: SERIES_DARK }
  : { surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', series: SERIES_LIGHT });

/**
 * Stable colour slots for the current selection: a country keeps its slot while selected, prefers its home slot,
 * and otherwise takes the lowest free slot. Up to 8 countries are selectable, so colours never repeat on screen.
 */
const slotOf = new Map<CountryCode, number>();
export function assignCountrySlots(codes: CountryCode[]): void {
  for (const k of [...slotOf.keys()]) if (!codes.includes(k)) slotOf.delete(k);
  for (const c of codes) {
    if (slotOf.has(c)) continue;
    const used = new Set(slotOf.values());
    let slot = used.has(COUNTRY_SLOT[c]) ? 0 : COUNTRY_SLOT[c];
    while (used.has(slot) && slot < 8) slot++;
    slotOf.set(c, slot % 8);
  }
}

export function countryColor(code: CountryCode): string {
  return chrome().series[slotOf.get(code) ?? COUNTRY_SLOT[code]]!;
}

export const baseOption = () => {
  const c = chrome();
  return {
    backgroundColor: 'transparent',
    textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: c.ink2 },
    animationDuration: 300,
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis' as const,
      triggerOn: 'mousemove' as const,
      backgroundColor: c.surface,
      borderColor: c.grid,
      textStyle: { color: c.ink, fontSize: 12 },
      extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,.12); border-radius: 8px;',
    },
    legend: { type: 'scroll' as const, top: 0, left: 0, right: 0, icon: 'roundRect', pageIconColor: c.ink2, pageIconInactiveColor: c.axis, pageTextStyle: { color: c.muted }, itemWidth: 12, itemHeight: 12, textStyle: { color: c.ink2 } },
    axisStyle: {
      axisLine: { lineStyle: { color: c.axis } },
      axisTick: { show: false },
      axisLabel: { color: c.muted },
      splitLine: { lineStyle: { color: c.grid } },
    },
  };
};

/** Attach a ResizeObserver so the chart tracks its container. */
export function mountChart(el: HTMLElement): echarts.ECharts {
  const chart = echarts.init(el, undefined, { renderer: 'canvas' });
  const ro = new ResizeObserver(() => { if (chart.isDisposed()) ro.disconnect(); else chart.resize(); });
  ro.observe(el);
  return chart;
}
