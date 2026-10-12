import type { Asset, CountryCode } from '../../schemas';
import { compareAll, fxFor } from '../engine/compare';
import type { Ledger } from '../engine/types';
import { availableCountries, dataset } from '../data/loader';
import { colBars, colOption } from './charts/col';
import { gdpBars, gdpHistoryOption, gdpOption } from './charts/gdp';
import { networthOption, type NetworthSeriesMeta } from './charts/networth';
import { taxStackOption, type TaxStackMeta } from './charts/taxstack';
import { echarts, mountChart } from './charts/theme';
import { renderDrilldown, type DrillTarget } from './components/drilldown';
import { freshnessFooter } from './components/freshness';
import { inputsPanel } from './components/inputs-panel';
import { $, clear, h } from './dom';
import { ASSET_LABEL, pct, usd, usdCompact } from './format';
import { decodeState, encodeState, type AppState } from './state';

const REPO_URL = 'https://github.com/crazysoftwarecoder/taxmeless';

export function startApp(): void {
  let state: AppState = decodeState(location.search);
  // Drop countries that have no data yet.
  const available = new Set(availableCountries.map((c) => c.code));
  state.countries = state.countries.filter((c) => available.has(c));
  if (!state.countries.length) state.countries = [availableCountries[0]!.code];

  const names = Object.fromEntries(dataset.countries.countries.map((c) => [c.code, c.name])) as Record<CountryCode, string>;

  const inputsHost = $('#inputs');
  const summaryHost = $('#summary');
  const nwHost = $('#networth-charts');
  const taxChart = mountChart($('#tax-chart'));
  const gdpChart = mountChart($('#gdp-chart'));
  const colChart = mountChart($('#col-chart'));
  const sheet = $('#sheet');
  const sheetBody = $('#sheet-body');
  const sheetChart = $('#sheet-chart');
  const nwCharts = new Map<Asset, echarts.ECharts>();
  let ledgers: Ledger[] = [];

  $('#footer').append(freshnessFooter(dataset, REPO_URL));

  const inputs = (): Parameters<typeof compareAll>[0] => ({
    countries: state.countries,
    asset: state.asset,
    horizonYears: state.horizon,
    principalUsd: state.principal,
    equities: { growth: state.eqGrowth / 100, yield: state.eqYield / 100 },
    property: { growth: state.prGrowth / 100, yield: state.prYield / 100, costRate: state.prCost / 100 },
    otherIncomeBand: state.income,
  });

  function openSheet(target: DrillTarget): void {
    const ledger = ledgers.find((l) => l.country === target.country && l.asset === target.asset);
    if (!ledger) return;
    const t = dataset.tax[target.country];
    renderDrilldown(sheetBody, ledger, target, {
      names,
      jurisdictionNote: (c) => dataset.tax[c]?.jurisdiction_note,
      taxYear: (c) => dataset.tax[c]?.tax_year,
    });
    sheetChart.hidden = true;
    sheet.hidden = false;
    sheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('sheet-open');
    $('#sheet-close').focus();
    void t;
  }

  let sheetChartInstance: echarts.ECharts | undefined;
  function openGdpSheet(country: CountryCode): void {
    const g = dataset.gdp[country];
    if (!g) return;
    clear(sheetBody);
    const rate = g.projection.method === 'manual' ? (g.projection.cagr ?? 0) : undefined;
    sheetBody.append(
      h('header', { class: 'sheet-head' },
        h('h3', null, `GDP per capita · ${names[country]}`),
        h('p', { class: 'muted' }, `${g.indicator}. Projection: ${g.projection.method === 'manual' ? `manual CAGR ${pct(rate ?? 0)}` : 'compound growth of the last 10 years'}.`),
      ),
    );
    sheetChart.hidden = false;
    sheetChartInstance ??= mountChart(sheetChart);
    sheetChartInstance.setOption(gdpHistoryOption(g, state.horizon), { notMerge: true });
    sheetBody.append(
      h('footer', { class: 'src' },
        h('a', { href: g.meta.source, target: '_blank', rel: 'noopener' }, g.meta.source_title ?? 'Source'),
        h('span', { class: 'verified' }, `verified ${g.meta.last_verified}`),
      ),
    );
    sheet.hidden = false;
    sheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('sheet-open');
    $('#sheet-close').focus();
    requestAnimationFrame(() => sheetChartInstance?.resize());
  }

  function closeSheet(): void {
    sheet.hidden = true;
    sheet.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('sheet-open');
  }
  $('#sheet-close').addEventListener('click', closeSheet);
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });

  function renderSummary(): void {
    clear(summaryHost);
    const assets: Asset[] = state.asset === 'both' ? ['equities', 'property'] : [state.asset];
    for (const asset of assets) {
      const rows = ledgers.filter((l) => l.asset === asset).sort((a, b) => b.finalNetUsd - a.finalNetUsd);
      const table = h('table', { class: 'summary' },
        h('caption', null, `${ASSET_LABEL[asset]} · ${usdCompact(state.principal)} after ${state.horizon} years`),
        h('thead', null, h('tr', null,
          h('th', null, 'Country'), h('th', { class: 'num' }, 'Net value'), h('th', { class: 'num' }, 'Total tax'),
          h('th', { class: 'num' }, 'Tax / gain'), h('th', { class: 'num' }, 'Ingress'), h('th', { class: 'num' }, 'Growth'), h('th', { class: 'num' }, 'Egress'),
        )),
        h('tbody', null, ...rows.map((l) => h('tr', { tabindex: 0, role: 'button', 'aria-label': `Show taxes for ${names[l.country]} ${asset}`,
          onclick: () => openSheet({ country: l.country, asset, stage: 'egress' }),
          onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSheet({ country: l.country, asset, stage: 'egress' }); } },
        },
          h('td', null, h('span', { class: 'swatch', dataset: { country: l.country } }), names[l.country]),
          h('td', { class: 'num' }, usd(l.finalNetUsd)),
          h('td', { class: 'num' }, usd(l.totalsUsd.taxes.all)),
          h('td', { class: 'num' }, pct(l.effectiveTaxRate)),
          h('td', { class: 'num' }, usdCompact(l.totalsUsd.taxes.ingress)),
          h('td', { class: 'num' }, usdCompact(l.totalsUsd.taxes.growth)),
          h('td', { class: 'num' }, usdCompact(l.totalsUsd.taxes.egress)),
        ))),
      );
      summaryHost.append(table);
    }
  }

  function renderNetworth(): void {
    const assets: Asset[] = state.asset === 'both' ? ['equities', 'property'] : [state.asset];
    // Create or remove per-asset chart panels.
    for (const [asset, chart] of nwCharts) {
      if (!assets.includes(asset)) { chart.dispose(); nwCharts.delete(asset); nwHost.querySelector(`[data-asset="${asset}"]`)?.remove(); }
    }
    for (const asset of assets) {
      if (!nwCharts.has(asset)) {
        const panel = h('div', { class: 'chart-panel', dataset: { asset } },
          h('h3', null, `${ASSET_LABEL[asset]} · net worth after tax`),
          h('div', { class: 'chart chart-tall', role: 'img', 'aria-label': `Net worth over time for ${asset}` }),
        );
        nwHost.append(panel);
        const chart = mountChart(panel.querySelector<HTMLElement>('.chart')!);
        // Generous hit target: any click inside the plot snaps to the nearest year and the nearest country line.
        chart.getZr().on('click', (e: { offsetX: number; offsetY: number }) => {
          if (!chart.containPixel('grid', [e.offsetX, e.offsetY])) return;
          const rows = ledgers.filter((l) => l.asset === asset);
          if (!rows.length) return;
          const [xi, yv] = chart.convertFromPixel({ seriesId: JSON.stringify({ country: rows[0]!.country, asset } satisfies NetworthSeriesMeta) }, [e.offsetX, e.offsetY]) as [number, number];
          const year = Math.max(0, Math.min(rows[0]!.rows.length - 1, Math.round(xi)));
          const nearest = rows.reduce((best, l) => {
            const d = Math.abs(l.rows[year]!.netValueUsd - yv);
            return d < best.d ? { d, l } : best;
          }, { d: Infinity, l: rows[0]! });
          openSheet({ country: nearest.l.country, asset, year });
        });
        nwCharts.set(asset, chart);
      }
      nwCharts.get(asset)!.setOption(networthOption(ledgers, asset, names, window.innerWidth < 720), { notMerge: true });
    }
    nwHost.classList.toggle('two-up', assets.length === 2);
  }

  function render(): void {
    history.replaceState(null, '', `${location.pathname}${encodeState(state)}`);
    clear(inputsHost);
    inputsHost.append(inputsPanel(state, availableCountries, (patch) => { state = { ...state, ...patch }; render(); }));

    ledgers = compareAll(inputs(), dataset);
    renderSummary();
    renderNetworth();
    taxChart.setOption(taxStackOption(ledgers, names), { notMerge: true });

    const gb = gdpBars(dataset.gdp, state.countries, state.horizon);
    gdpChart.setOption(gdpOption(gb, names, state.horizon), { notMerge: true });
    $('#gdp-note').textContent = gb.length
      ? `Trend CAGR: ${gb.map((x) => `${names[x.country]} ${pct(x.cagr)}`).join(' · ')}. Click a bar for the full history.`
      : 'GDP data not yet available for the selected countries.';

    const cb = colBars(dataset.col, (c) => fxFor(dataset, c), state.countries, state.horizon);
    colChart.setOption(colOption(cb, names), { notMerge: true });
    $('#col-note').textContent = cb.length
      ? `Annual spend for two adults and two children in ${cb[0]!.year}, inflated at each country's CPI from the base year, converted at today's exchange rates.`
      : 'Cost-of-living data not yet available for the selected countries.';
  }

  taxChart.on('click', (p) => {
    const meta = (p.data as { meta?: TaxStackMeta }).meta;
    if (meta) openSheet({ country: meta.country, asset: meta.asset, stage: meta.stage });
  });
  gdpChart.on('click', (p) => {
    const meta = (p.data as { meta?: { country: CountryCode } }).meta;
    if (meta) openGdpSheet(meta.country);
  });

  $('#copy-link').addEventListener('click', async () => {
    const btn = $('#copy-link');
    try {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = 'Link copied';
    } catch {
      btn.textContent = location.href;
    }
    setTimeout(() => { btn.textContent = 'Copy link'; }, 1800);
  });

  const themeBtn = $('#theme-toggle');
  themeBtn.addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme;
    const next = cur === 'dark' ? 'light' : cur === 'light' ? '' : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
    if (next) document.documentElement.dataset.theme = next; else delete document.documentElement.dataset.theme;
    try { localStorage.setItem('theme', next); } catch { /* ignore */ }
    for (const c of nwCharts.values()) c.dispose();
    nwCharts.clear();
    clear(nwHost);
    render();
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!document.documentElement.dataset.theme) render(); });

  render();
}
