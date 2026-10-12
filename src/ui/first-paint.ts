/** Renders the inputs and summary before the chart bundle loads (no ECharts dependency). */
import type { CountryCode } from '../../schemas';
import { availableCountries, dataset } from '../data/loader';
import { compareAll } from '../engine/compare';
import { deflateLedger } from '../engine/deflate';
import { assignCountrySlots } from './charts/palette';
import { inputsPanel } from './components/inputs-panel';
import { renderSummary } from './components/summary';
import { $, clear } from './dom';
import { decodeState, type AppState } from './state';

export function firstPaintInputs(state: AppState): Parameters<typeof compareAll>[0] {
  return {
    countries: state.countries,
    asset: state.asset,
    horizonYears: state.horizon,
    principalUsd: state.principal,
    equities: { growth: state.eqGrowth / 100, yield: state.eqYield / 100 },
    property: { growth: state.prGrowth / 100, yield: state.prYield / 100, costRate: state.prCost / 100, lvr: state.lvr / 100, interestRate: state.rate / 100 },
    otherIncomeBand: state.income,
    startDate: new Date().toISOString().slice(0, 10),
    inflation: state.infl / 100,
  };
}

export function firstPaint(): void {
  const state = decodeState(location.search);
  const available = new Set(availableCountries.map((c) => c.code));
  state.countries = state.countries.filter((c) => available.has(c));
  if (!state.countries.length) state.countries = [availableCountries[0]!.code];
  assignCountrySlots(state.countries);
  const names = Object.fromEntries(dataset.countries.countries.map((c) => [c.code, c.name])) as Record<CountryCode, string>;
  let ledgers = compareAll(firstPaintInputs(state), dataset);
  if (state.real) ledgers = ledgers.map((l) => deflateLedger(l, state.infl / 100));
  const inputsHost = $('#inputs');
  clear(inputsHost);
  inputsHost.append(inputsPanel(state, availableCountries, () => {}));
  renderSummary($('#summary'), ledgers, state, names, () => {});
  // Reserve the space the net-worth charts will take so nothing shifts when the chart bundle arrives.
  const panels = state.asset === 'both' && !matchMedia('(min-width: 1200px)').matches ? 2 : 1;
  $('#networth-charts').style.minHeight = `${panels * 360 + (panels - 1) * 16}px`;
  document.body.classList.remove('booting');
}
