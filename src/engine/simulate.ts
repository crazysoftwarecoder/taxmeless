import type { Asset, Assumptions, Base, Rule, Schedule, Stage, TaxFile } from '../../schemas';
import { applyRule, type GainWindow, type RuleContext } from './rules';
import { INCOME_BAND_INDEX, type Ledger, type SimInputs, type StageTotals, type TaxEvent, type YearRow } from './types';

const STAGES: Stage[] = ['ingress', 'growth', 'egress'];
export const DEFAULT_START_DATE = '2026-10-12';
const YEAR_MS = 365.25 * 86_400_000;

export function addYears(iso: string, years: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + years * YEAR_MS).toISOString().slice(0, 10);
}
export function yearsBetween(fromIso: string, toIso: string): number {
  return (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / YEAR_MS;
}
/** The income-tax schedule in force on a date, honouring legislated future changes. */
export function scheduleOn(tax: TaxFile, iso: string): Schedule {
  let s = tax.income_tax;
  for (const c of [...(tax.income_tax_changes ?? [])].sort((a, b) => a.effective_from.localeCompare(b.effective_from))) {
    if (iso >= c.effective_from) s = c.schedule;
  }
  return s;
}

function zeroStages(): StageTotals {
  return { ingress: 0, growth: 0, egress: 0 };
}

interface PathYear {
  opening: number;
  income: number;
  growth: number;
  closing: number;
  events: TaxEvent[];
}

const usesIncomeTaxRef = (r: Rule) => r.kind.type === 'schedule' && '$ref' in r.kind.schedule && r.kind.stack_on_other_income;

/**
 * Simulate one country × one asset. Pure and deterministic.
 * All internal arithmetic is in local currency; the returned Ledger is in USD.
 */
export function simulate(inputs: SimInputs, tax: TaxFile, asset: Asset, assumptions: Assumptions, fx: number): Ledger {
  const H = Math.max(1, Math.floor(inputs.horizonYears));
  const start = inputs.startDate ?? DEFAULT_START_DATE;
  const cpi = inputs.inflation ?? 0.025;
  const principal = inputs.principalUsd * fx;
  const otherIncome = tax.resident_profile.other_income_options[INCOME_BAND_INDEX[inputs.otherIncomeBand]];
  const params = asset === 'equities'
    ? { growth: inputs.equities.growth, yield: inputs.equities.yield, costRate: 0 }
    : { growth: inputs.property.growth, yield: inputs.property.yield, costRate: inputs.property.costRate };
  const landFraction = assumptions.property.land_fraction;

  const rulesFor = (stage: Stage, taxesOn: boolean): Rule[] =>
    [...tax.assets[asset][stage], ...tax.levies.filter((l) => l.stage === stage)]
      .filter((r) => taxesOn || r.category === 'cost');

  const runPath = (taxesOn: boolean): PathYear[] => {
    const years: PathYear[] = [];
    // Per-year history (pre-egress) used to split gains by accrual date.
    const V: number[] = [];
    const CB: number[] = [];
    const reinv: number[] = [];
    const interp = (arr: (k: number) => number, t: number) => {
      const T = V.length - 1;
      const i = Math.min(T, Math.floor(t));
      const f = t - i;
      return f <= 0 || i >= T ? arr(i) : arr(i) * (1 - f) + arr(i + 1) * f;
    };
    const U = (t: number) => interp((k) => V[k]! - CB[k]!, t);
    const Vt = (t: number) => interp((k) => V[k]!, t);
    const gainWindow: GainWindow = (from, until, index) => {
      const T = V.length - 1;
      const t1 = from ? Math.min(T, Math.max(0, yearsBetween(start, from))) : 0;
      const t2 = until ? Math.min(T, Math.max(0, yearsBetween(start, until))) : T;
      if (t2 < t1 || (t2 === t1 && t1 > 0)) return { gain: 0, indexation: 0 };
      const gain = t1 === 0 ? U(t2) : U(t2) - U(t1);
      let indexation = 0;
      if (index) {
        const baseAt = t1 === 0 ? CB[0]! : Vt(t1);
        indexation = baseAt * (Math.pow(1 + cpi, t2 - t1) - 1);
        for (let y = Math.max(1, Math.ceil(t1 + 1e-9)); y <= Math.floor(t2 + 1e-9); y++) {
          indexation += (reinv[y] ?? 0) * (Math.pow(1 + cpi, t2 - y) - 1);
        }
      }
      return { gain, indexation };
    };

    const apply = (stage: Stage, year: number, holdingYears: number, bases: Record<Base, number>): TaxEvent[] => {
      const eventDate = addYears(start, year);
      const base: RuleContext = {
        stage, year, holdingYears, bases, otherIncome, eventDate, gainWindow,
        incomeTax: scheduleOn(tax, eventDate),
        frankedFractionDefault: assumptions.equities.franked_fraction,
        fx,
      };
      const out: TaxEvent[] = [];
      let stacked = 0; // taxable amounts already stacked on the income-tax schedule this stage-year
      for (const r of rulesFor(stage, taxesOn)) {
        const ref = usesIncomeTaxRef(r);
        const ev = applyRule(r, ref ? { ...base, otherIncome: otherIncome + stacked } : base);
        if (ev) {
          out.push(ev);
          if (ref) stacked += ev.taxable;
        }
      }
      return out;
    };
    const sum = (evs: TaxEvent[]) => evs.reduce((a, e) => a + e.amount, 0);

    // Year 0: deploy the principal.
    const ingress = apply('ingress', 0, 0, { principal, value: principal, land_value: principal * landFraction, income: 0, gain: 0 });
    let value = principal - sum(ingress);
    let costBase = principal; // outlay incl. entry costs forms the cost base
    V.push(value); CB.push(costBase); reinv.push(0);
    years.push({ opening: principal, income: 0, growth: 0, closing: value, events: ingress });

    for (let y = 1; y <= H; y++) {
      const opening = value;
      const grossIncome = opening * params.yield;
      const netIncome = grossIncome * (1 - params.costRate);
      const growthAmt = opening * params.growth;
      const events = apply('growth', y, y, { principal, value: opening, land_value: opening * landFraction, income: netIncome, gain: 0 });
      const reinvested = netIncome - sum(events);
      value = opening + growthAmt + reinvested;
      costBase += reinvested;
      V.push(value); CB.push(costBase); reinv.push(reinvested);
      if (y === H) {
        const gain = Math.max(0, value - costBase);
        const egress = apply('egress', y, y, { principal, value, land_value: value * landFraction, income: 0, gain });
        value -= sum(egress);
        events.push(...egress);
      }
      years.push({ opening, income: netIncome, growth: growthAmt, closing: value, events });
    }
    return years;
  };

  const net = runPath(true);
  const gross = runPath(false);

  const rows: YearRow[] = net.map((n, i) => {
    const taxes = zeroStages();
    const costs = zeroStages();
    for (const e of n.events) {
      (e.category === 'tax' ? taxes : costs)[e.stage] += e.amountUsd;
    }
    return {
      year: i,
      openingValueUsd: n.opening / fx,
      incomeUsd: n.income / fx,
      growthUsd: n.growth / fx,
      taxesUsd: taxes,
      costsUsd: costs,
      events: n.events,
      grossValueUsd: (gross[i]?.closing ?? 0) / fx,
      netValueUsd: n.closing / fx,
    };
  });

  const totals = { taxes: { ...zeroStages(), all: 0 }, costs: { ...zeroStages(), all: 0 } };
  for (const r of rows) {
    for (const s of STAGES) {
      totals.taxes[s] += r.taxesUsd[s];
      totals.costs[s] += r.costsUsd[s];
    }
  }
  totals.taxes.all = STAGES.reduce((a, s) => a + totals.taxes[s], 0);
  totals.costs.all = STAGES.reduce((a, s) => a + totals.costs[s], 0);

  const last = rows[rows.length - 1]!;
  const grossGain = last.grossValueUsd - inputs.principalUsd;
  return {
    country: tax.country,
    asset,
    currency: tax.currency,
    fx,
    principalUsd: inputs.principalUsd,
    horizonYears: H,
    rows,
    totalsUsd: totals,
    finalGrossUsd: last.grossValueUsd,
    finalNetUsd: last.netValueUsd,
    effectiveTaxRate: grossGain > 0 ? totals.taxes.all / grossGain : 0,
    dragPct: last.grossValueUsd > 0 ? 1 - last.netValueUsd / last.grossValueUsd : 0,
  };
}
