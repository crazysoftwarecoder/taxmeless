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

interface PathResult { years: PathYear[]; price: number; loan: number }

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

  // Leverage (property only): interest-only loan at a fixed rate.
  const lvr = asset === 'property' ? Math.min(0.9, Math.max(0, inputs.property.lvr ?? 0)) : 0;
  const rate = inputs.property.interestRate ?? 0.06;
  const policy = tax.property_leverage;
  const lossTreatment = (iso: string) => {
    let t = policy.rental_loss[0]!.treatment;
    for (const e of [...policy.rental_loss].sort((x, y) => (x.effective_from ?? '').localeCompare(y.effective_from ?? ''))) {
      if (!e.effective_from || iso >= e.effective_from) t = e.treatment;
    }
    return t;
  };

  const runPath = (taxesOn: boolean): PathResult => {
    const years: PathYear[] = [];
    // Per-year asset history (pre-egress) used to split gains by accrual date.
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

    const apply = (
      stage: Stage, year: number, holdingYears: number, bases: Record<Base, number>,
      extra: Pick<RuleContext, 'allowNegativeIncome' | 'gainLossPool'> = {},
    ): TaxEvent[] => {
      const eventDate = addYears(start, year);
      const base: RuleContext = {
        stage, year, holdingYears, bases, otherIncome, eventDate, gainWindow, ...extra,
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
    const policyEvent = (
      year: number, stage: Stage, category: 'tax' | 'cost', label: string, base: number, baseKind: Base,
      amount: number, explanation: string, taxable = base,
    ): TaxEvent => ({
      ruleId: `leverage_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, label, stage, category, year, baseKind, base, taxable,
      rate: base > 0 && amount ? amount / base : undefined, amount, amountUsd: amount / fx, explanation, meta: policy.meta,
    });
    const bases = (price: number, value: number, loan: number, income: number, gain: number): Record<Base, number> => ({
      principal: price, value, net_value: value - loan, land_value: value * landFraction, income, gain, loan,
    });

    // Year 0: solve the purchase price so that deposit + entry costs = cash invested.
    const ingressAt = (price: number) => apply('ingress', 0, 0, bases(price, price, price * lvr, 0, 0));
    let price = principal;
    if (lvr > 0 || ingressAt(principal).length) {
      let lo = 0;
      let hi = principal / (1 - lvr);
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (mid * (1 - lvr) + sum(ingressAt(mid)) > principal) hi = mid; else lo = mid;
      }
      price = lo;
    }
    const loan = price * lvr;
    const ingress = ingressAt(price);
    let value = price;
    let costBase = price + sum(ingress);
    let cash = principal - (price - loan) - sum(ingress); // ~0 after solving
    let lossPool = 0; // quarantined rental losses
    let financePool = 0; // unrelieved finance costs (credit regimes)
    V.push(value); CB.push(costBase); reinv.push(0);
    years.push({ opening: principal, income: 0, growth: 0, closing: value - loan + cash, events: ingress });

    for (let y = 1; y <= H; y++) {
      const eventDate = addYears(start, y);
      const opening = value;
      const grossIncome = opening * params.yield;
      const netIncome = grossIncome * (1 - params.costRate);
      const interest = loan * rate;
      const growthAmt = opening * params.growth;
      const pre: TaxEvent[] = [];
      let incomeBase = netIncome;
      let allowNegativeIncome = false;
      if (asset === 'property') {
        if (interest > 0) pre.push(policyEvent(y, 'growth', 'cost', 'Mortgage interest', loan, 'loan', interest,
          `Interest-only loan at ${(rate * 100).toFixed(2)}% on ${(lvr * 100).toFixed(0)}% of the purchase price. ${policy.plain_english}`));
        if (taxesOn) {
          let profit = policy.interest_deductible ? netIncome - interest : netIncome;
          const treatment = lossTreatment(eventDate);
          if (profit > 0 && lossPool > 0 && treatment !== 'offset_other_income') {
            const use = Math.min(lossPool, profit);
            profit -= use;
            lossPool -= use;
            pre.push(policyEvent(y, 'growth', 'tax', 'Carried-forward rental loss used', use, 'income', 0,
              'Rental losses carried forward from earlier years reduce this year\'s taxable rent.'));
          }
          if (profit < 0) {
            if (treatment === 'offset_other_income') allowNegativeIncome = true;
            else {
              if (treatment !== 'lapse') lossPool += -profit;
              pre.push(policyEvent(y, 'growth', 'tax', treatment === 'lapse' ? 'Rental loss (cannot be used)' : 'Rental loss carried forward', -profit, 'income', 0,
                treatment === 'lapse'
                  ? 'The rental loss cannot reduce tax on other income here and is not carried forward.'
                  : 'The rental loss cannot reduce tax on your salary. It is carried forward to offset future rental profits' + (treatment === 'carry_forward_incl_gains' ? ' and the capital gain when you sell.' : '.')));
              profit = 0;
            }
          }
          incomeBase = profit;
          if (policy.finance_cost_credit_rate && !policy.interest_deductible && interest > 0) {
            financePool += interest;
            const relieved = Math.min(financePool, Math.max(0, profit));
            financePool -= relieved;
            if (relieved > 0) pre.push(policyEvent(y, 'growth', 'tax', 'Finance cost tax credit', relieved, 'loan',
              -relieved * policy.finance_cost_credit_rate,
              `Mortgage interest is not deducted from rent. Instead you get a ${(policy.finance_cost_credit_rate * 100).toFixed(0)}% tax credit on it, limited to your rental profit; unrelieved interest carries forward.`));
          }
        }
      }
      const events = [...pre, ...apply('growth', y, y, bases(price, opening, loan, incomeBase, 0), { allowNegativeIncome })];
      const taxesPaid = events.filter((e) => e.category === 'tax').reduce((a, e) => a + e.amount, 0);
      const costsPaid = events.filter((e) => e.category === 'cost').reduce((a, e) => a + e.amount, 0);
      const flow = netIncome - costsPaid - taxesPaid;
      value = opening + growthAmt;
      let reinvested = 0;
      if (flow >= 0) { value += flow; costBase += flow; reinvested = flow; } else cash += flow;
      V.push(value); CB.push(costBase); reinv.push(reinvested);
      if (y === H) {
        const gain = Math.max(0, value - costBase);
        const usesGains = taxesOn && lossTreatment(eventDate) === 'carry_forward_incl_gains' && lossPool > 0;
        const pool = usesGains ? { remaining: lossPool, used: new Map<string, number>() } : undefined;
        const egress = apply('egress', y, y, bases(price, value, loan, 0, gain), { gainLossPool: pool });
        if (pool && pool.remaining < lossPool) {
          egress.push(policyEvent(y, 'egress', 'tax', 'Carried-forward rental losses used against the gain', lossPool - pool.remaining, 'gain', 0,
            'Rental losses that could not offset your salary are deducted from the taxable capital gain on sale.'));
        }
        value -= sum(egress);
        events.push(...egress);
      }
      years.push({ opening: opening - loan + cash, income: netIncome - (asset === 'property' ? interest : 0), growth: growthAmt, closing: value - loan + cash, events });
    }
    return { years, price, loan };
  };

  const netRun = runPath(true);
  const net = netRun.years;
  const gross = runPath(false).years;

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
    purchasePriceUsd: netRun.price / fx,
    loanUsd: netRun.loan / fx,
    rows,
    totalsUsd: totals,
    finalGrossUsd: last.grossValueUsd,
    finalNetUsd: last.netValueUsd,
    effectiveTaxRate: grossGain > 0 ? totals.taxes.all / grossGain : 0,
    dragPct: last.grossValueUsd > 0 ? 1 - last.netValueUsd / last.grossValueUsd : 0,
  };
}
