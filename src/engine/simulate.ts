import type { Asset, Assumptions, Base, Rule, Stage, TaxFile } from '../../schemas';
import { applyRule, type RuleContext } from './rules';
import { INCOME_BAND_INDEX, type Ledger, type SimInputs, type StageTotals, type TaxEvent, type YearRow } from './types';

const STAGES: Stage[] = ['ingress', 'growth', 'egress'];

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

/**
 * Simulate one country × one asset. Pure and deterministic.
 * All internal arithmetic is in local currency; the returned Ledger is in USD.
 */
export function simulate(inputs: SimInputs, tax: TaxFile, asset: Asset, assumptions: Assumptions, fx: number): Ledger {
  const H = Math.max(1, Math.floor(inputs.horizonYears));
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
    const ctxBase = {
      otherIncome,
      incomeTax: tax.income_tax,
      frankedFractionDefault: assumptions.equities.franked_fraction,
      fx,
    };
    const apply = (stage: Stage, year: number, holdingYears: number, bases: Record<Base, number>): TaxEvent[] => {
      const ctx: RuleContext = { ...ctxBase, stage, year, holdingYears, bases };
      const out: TaxEvent[] = [];
      for (const r of rulesFor(stage, taxesOn)) {
        const ev = applyRule(r, ctx);
        if (ev) out.push(ev);
      }
      return out;
    };
    const sum = (evs: TaxEvent[]) => evs.reduce((a, e) => a + e.amount, 0);

    // Year 0: deploy the principal.
    const ingress = apply('ingress', 0, 0, { principal, value: principal, land_value: principal * landFraction, income: 0, gain: 0 });
    let value = principal - sum(ingress);
    let costBase = principal; // outlay incl. entry costs forms the cost base
    years.push({ opening: principal, income: 0, growth: 0, closing: value, events: ingress });

    for (let y = 1; y <= H; y++) {
      const opening = value;
      const grossIncome = opening * params.yield;
      const netIncome = grossIncome * (1 - params.costRate);
      const growthAmt = opening * params.growth;
      const growthEvents = apply('growth', y, y, { principal, value: opening, land_value: opening * landFraction, income: netIncome, gain: 0 });
      const growthTax = sum(growthEvents);
      const reinvested = netIncome - growthTax;
      value = opening + growthAmt + reinvested;
      costBase += reinvested;
      const events = growthEvents;
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
