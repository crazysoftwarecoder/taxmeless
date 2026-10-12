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
  if (extra <= 0) return 0;
  return taxOnSchedule(schedule, otherIncome + extra) - taxOnSchedule(schedule, otherIncome);
}

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

  const base = ctx.bases[rule.base];
  if (rule.kind.type !== 'fixed' && base <= 0) return null;

  let inclusion = m.inclusion ?? 1;
  if (m.min_holding_years !== undefined && ctx.holdingYears < m.min_holding_years) inclusion = 1;
  let taxable = base * inclusion * (m.taxable_fraction ?? 1);

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

  return {
    ruleId: rule.id,
    label: rule.label,
    stage: rule.stage,
    category: rule.category,
    year: ctx.year,
    baseKind: rule.base,
    base,
    taxable,
    rate: base > 0 ? amount / base : undefined,
    amount,
    amountUsd: amount / ctx.fx,
    explanation: rule.plain_english,
    meta: rule.meta,
  };
}
