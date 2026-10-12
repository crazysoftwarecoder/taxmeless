import type { Base, Rule, Schedule, Stage } from '../../schemas';
import type { TaxEvent } from './types';

/** Tax on `amount` measured from zero through a marginal schedule. */
export function taxOnSchedule(schedule: Schedule, amount: number): number {
  if (amount <= 0) return 0;
  let tax = 0;
  for (const b of schedule.brackets) {
    if (amount <= b.from) break;
    const upper = b.to === null ? amount : Math.min(amount, b.to);
    tax += (upper - b.from) * b.rate;
  }
  return tax;
}

/** Tax attributable to `extra` when stacked on top of `otherIncome`. */
export function marginalTax(schedule: Schedule, otherIncome: number, extra: number): number {
  if (extra === 0) return 0;
  return taxOnSchedule(schedule, Math.max(0, otherIncome + extra)) - taxOnSchedule(schedule, otherIncome);
}

/** Unrealised gain that accrued between two dates (local currency) and the CPI indexation allowance for it. */
export type GainWindow = (from: string | undefined, until: string | undefined, index: boolean) => { gain: number; indexation: number };

export interface RuleContext {
  stage: Stage;
  year: number;
  /** Years the asset has been held at the moment the rule is applied. */
  holdingYears: number;
  /** Local-currency bases available at this stage. */
  bases: Record<Base, number>;
  otherIncome: number;
  incomeTax: Schedule;
  frankedFractionDefault: number;
  /** Local currency units per USD. */
  fx: number;
  /** Date of the event (YYYY-MM-DD). */
  eventDate?: string;
  /** Lets gain rules restrict themselves to an accrual window and apply indexation. */
  gainWindow?: GainWindow;
  /** A negative 'income' base (rental loss) may reduce tax on other income. */
  allowNegativeIncome?: boolean;
  /** Carried-forward losses that may reduce taxable gains; each accrual window consumes once and levies reuse it. */
  gainLossPool?: { remaining: number; used: Map<string, number> };
}

function resolveSchedule(rule: Extract<Rule['kind'], { type: 'schedule' }>, ctx: RuleContext): Schedule {
  return '$ref' in rule.schedule ? ctx.incomeTax : rule.schedule;
}

/**
 * The single interpreter. Returns null when the rule does not apply (wrong stage, exemption,
 * threshold not met, or nothing to tax). Never contains country-specific code.
 */
export function applyRule(rule: Rule, ctx: RuleContext): TaxEvent | null {
  if (rule.stage !== ctx.stage) return null;
  const m = rule.modifiers ?? {};

  if (m.applies_if_other_income_above !== undefined && ctx.otherIncome <= m.applies_if_other_income_above) return null;
  if (m.exempt_after_years !== undefined && ctx.holdingYears >= m.exempt_after_years) return null;
  if (m.applies_until_years !== undefined && ctx.holdingYears >= m.applies_until_years) return null;

  if (ctx.eventDate) {
    if (m.effective_from !== undefined && ctx.eventDate < m.effective_from) return null;
    if (m.effective_until !== undefined && ctx.eventDate >= m.effective_until) return null;
  }

  const heldLongEnough = m.min_holding_years === undefined || ctx.holdingYears >= m.min_holding_years;
  let base = ctx.bases[rule.base];
  if (m.assessed_growth_cap !== undefined && (rule.base === 'principal' || rule.base === 'value')) {
    // Year 1 is assessed at the purchase price; increases start the following year.
    base = Math.min(ctx.bases.value, ctx.bases.principal * Math.pow(1 + m.assessed_growth_cap, Math.max(0, ctx.holdingYears - 1)));
  }
  let indexation = 0;
  if (rule.base === 'gain' && ctx.gainWindow && (m.accrual_from || m.accrual_until || m.cost_base_indexation)) {
    const w = ctx.gainWindow(m.accrual_from, m.accrual_until, !!m.cost_base_indexation && heldLongEnough);
    base = w.gain;
    indexation = w.indexation;
  }
  const negativeOk = rule.base === 'income' && !!ctx.allowNegativeIncome;
  if (rule.kind.type !== 'fixed' && (base === 0 || (base < 0 && !negativeOk))) return null;

  let inclusion = m.inclusion ?? 1;
  if (!heldLongEnough) inclusion = 1;
  let taxable = (base < 0 ? base : Math.max(0, base - indexation)) * inclusion * (m.taxable_fraction ?? 1);
  if (rule.base === 'gain' && ctx.gainLossPool && taxable > 0) {
    const key = `${m.accrual_from ?? ''}|${m.accrual_until ?? ''}`;
    const pool = ctx.gainLossPool;
    let reduction = pool.used.get(key);
    if (reduction === undefined) {
      reduction = Math.min(pool.remaining, taxable);
      pool.remaining -= reduction;
      pool.used.set(key, reduction);
    }
    taxable = Math.max(0, taxable - reduction);
  }
  if (rule.kind.type !== 'fixed' && (taxable === 0 || (taxable < 0 && !negativeOk))) return null;

  let credit = 0;
  if (m.imputation_credit_rate !== undefined && m.imputation_credit_rate > 0 && m.imputation_credit_rate < 1) {
    const r = m.imputation_credit_rate;
    const franked = taxable * (m.franked_fraction ?? ctx.frankedFractionDefault);
    const grossUp = (franked * r) / (1 - r);
    taxable += grossUp;
    credit = grossUp;
  }

  let amount: number;
  switch (rule.kind.type) {
    case 'flat':
      amount = taxable * rule.kind.rate;
      break;
    case 'schedule': {
      const s = resolveSchedule(rule.kind, ctx);
      amount = rule.kind.stack_on_other_income ? marginalTax(s, ctx.otherIncome, taxable) : taxOnSchedule(s, taxable);
      break;
    }
    case 'flat_above_allowance':
      amount = Math.max(0, taxable - rule.kind.allowance) * rule.kind.rate;
      break;
    case 'fixed':
      amount = rule.kind.amount;
      break;
  }
  amount -= credit;
  if (m.minimum_rate !== undefined && heldLongEnough) amount = Math.max(amount, taxable * m.minimum_rate);

  return {
    ruleId: rule.id,
    label: rule.label,
    stage: rule.stage,
    category: rule.category,
    year: ctx.year,
    baseKind: rule.base,
    base,
    taxable,
    rate: base !== 0 ? amount / base : undefined,
    amount,
    amountUsd: amount / ctx.fx,
    explanation: rule.plain_english,
    meta: rule.meta,
  };
}
