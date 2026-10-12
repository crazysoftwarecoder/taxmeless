import * as echarts from 'echarts/core';
import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { LabelLayout, LegacyGridContainLabel } from 'echarts/features';

echarts.use([BarChart, LineChart, ScatterChart, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, CanvasRenderer, LegacyGridContainLabel, LabelLayout]);
export { echarts };

export * from './palette';
import { chrome } from './palette';

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
