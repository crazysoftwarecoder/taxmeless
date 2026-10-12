import { describe, expect, it } from 'vitest';
import type { Rule, Schedule } from '../../../schemas';
import { applyRule, marginalTax, taxOnSchedule, type RuleContext } from '../rules';

const meta = { source: 'https://example.org', last_verified: '2026-01-01' };
const sched: Schedule = {
  brackets: [
    { from: 0, to: 18200, rate: 0 },
    { from: 18200, to: 45000, rate: 0.16 },
    { from: 45000, to: 135000, rate: 0.3 },
    { from: 135000, to: 190000, rate: 0.37 },
    { from: 190000, to: null, rate: 0.45 },
  ],
  meta,
};

function ctx(over: Partial<RuleContext> = {}): RuleContext {
  return {
    stage: 'growth',
    year: 1,
    holdingYears: 1,
    bases: { principal: 1_000_000, value: 1_000_000, net_value: 1_000_000, land_value: 600_000, income: 20_000, gain: 500_000, loan: 0 },
    otherIncome: 120_000,
    incomeTax: sched,
    frankedFractionDefault: 0.7,
    fx: 1,
    ...over,
  };
}

function rule(over: Partial<Rule>): Rule {
  return {
    id: 'r', label: 'r', stage: 'growth', category: 'tax', base: 'income',
    kind: { type: 'flat', rate: 0.1 }, plain_english: 'a rule used only in unit tests', meta, ...over,
  };
}

describe('taxOnSchedule / marginalTax', () => {
  it('computes bracket math from zero', () => {
    expect(taxOnSchedule(sched, 18200)).toBe(0);
    expect(taxOnSchedule(sched, 45000)).toBeCloseTo(26800 * 0.16, 6);
    expect(taxOnSchedule(sched, 200000)).toBeCloseTo(26800 * 0.16 + 90000 * 0.3 + 55000 * 0.37 + 10000 * 0.45, 6);
  });
  it('taxes the increment on top of other income', () => {
    expect(marginalTax(sched, 120_000, 10_000)).toBeCloseTo(10_000 * 0.3, 6);
    expect(marginalTax(sched, 130_000, 10_000)).toBeCloseTo(5000 * 0.3 + 5000 * 0.37, 6);
    expect(marginalTax(sched, 120_000, 0)).toBe(0);
  });
});

describe('applyRule', () => {
  it('ignores rules for another stage', () => {
    expect(applyRule(rule({ stage: 'egress' }), ctx())).toBeNull();
  });
  it('flat on income', () => {
    const ev = applyRule(rule({ kind: { type: 'flat', rate: 0.02 } }), ctx())!;
    expect(ev.amount).toBeCloseTo(400, 6);
    expect(ev.rate).toBeCloseTo(0.02, 6);
  });
  it('schedule via $ref stacked on other income', () => {
    const ev = applyRule(rule({ kind: { type: 'schedule', schedule: { $ref: 'income_tax' }, stack_on_other_income: true } }), ctx())!;
    // 120k + 20k crosses the 135k bracket: 15k @30% + 5k @37%
    expect(ev.amount).toBeCloseTo(15_000 * 0.3 + 5_000 * 0.37, 6);
  });
  it('schedule not stacked starts from zero (stamp duty)', () => {
    const ev = applyRule(rule({ stage: 'ingress', base: 'principal', kind: { type: 'schedule', schedule: sched, stack_on_other_income: false } }), ctx({ stage: 'ingress' }))!;
    expect(ev.amount).toBeCloseTo(taxOnSchedule(sched, 1_000_000), 6);
  });
  it('flat above allowance', () => {
    const ev = applyRule(rule({ kind: { type: 'flat_above_allowance', rate: 0.2, allowance: 5000 } }), ctx())!;
    expect(ev.amount).toBeCloseTo(15_000 * 0.2, 6);
    const none = applyRule(rule({ kind: { type: 'flat_above_allowance', rate: 0.2, allowance: 50_000 } }), ctx())!;
    expect(none.amount).toBe(0);
  });
  it('fixed amount applies even with zero base', () => {
    const ev = applyRule(rule({ kind: { type: 'fixed', amount: 3000 }, base: 'gain' }), ctx({ bases: { principal: 0, value: 0, net_value: 0, land_value: 0, income: 0, gain: 0, loan: 0 } }))!;
    expect(ev.amount).toBe(3000);
    expect(ev.rate).toBeUndefined();
  });
  it('inclusion applies only after min_holding_years', () => {
    const r = rule({ stage: 'egress', base: 'gain', kind: { type: 'flat', rate: 0.4 }, modifiers: { inclusion: 0.5, min_holding_years: 1 } });
    expect(applyRule(r, ctx({ stage: 'egress', holdingYears: 1 }))!.amount).toBeCloseTo(500_000 * 0.5 * 0.4, 6);
    expect(applyRule(r, ctx({ stage: 'egress', holdingYears: 0.5 }))!.amount).toBeCloseTo(500_000 * 0.4, 6);
  });
  it('exempt_after_years and applies_until_years', () => {
    const r = rule({ stage: 'egress', base: 'gain', kind: { type: 'flat', rate: 0.25 }, modifiers: { exempt_after_years: 10 } });
    expect(applyRule(r, ctx({ stage: 'egress', holdingYears: 10 }))).toBeNull();
    expect(applyRule(r, ctx({ stage: 'egress', holdingYears: 9 }))).not.toBeNull();
    const b = rule({ stage: 'egress', base: 'gain', kind: { type: 'flat', rate: 0.25 }, modifiers: { applies_until_years: 2 } });
    expect(applyRule(b, ctx({ stage: 'egress', holdingYears: 2 }))).toBeNull();
    expect(applyRule(b, ctx({ stage: 'egress', holdingYears: 1 }))).not.toBeNull();
  });
  it('applies_if_other_income_above threshold (NIIT)', () => {
    const r = rule({ kind: { type: 'flat', rate: 0.038 }, modifiers: { applies_if_other_income_above: 200_000 } });
    expect(applyRule(r, ctx({ otherIncome: 150_000 }))).toBeNull();
    expect(applyRule(r, ctx({ otherIncome: 250_000 }))!.amount).toBeCloseTo(760, 6);
  });
  it('imputation: gross-up then credit (AU franking round-trip)', () => {
    const r = rule({ kind: { type: 'schedule', schedule: { $ref: 'income_tax' }, stack_on_other_income: true }, modifiers: { imputation_credit_rate: 0.3, franked_fraction: 1 } });
    // 20k fully franked: gross-up 8571.43, taxable 28571.43 at 30% = 8571.43, minus credit 8571.43 = 0 at a 30% marginal rate.
    const ev = applyRule(r, ctx({ otherIncome: 60_000 }))!;
    expect(ev.amount).toBeCloseTo(0, 4);
    // at 45% marginal: tax 28571.43*0.45 - 8571.43 = 4285.71
    const hi = applyRule(r, ctx({ otherIncome: 300_000 }))!;
    expect(hi.amount).toBeCloseTo(28571.4286 * 0.45 - 8571.4286, 2);
    // at 0% marginal the credit is refunded (negative amount)
    const lo = applyRule(r, ctx({ otherIncome: 0, bases: { principal: 0, value: 0, net_value: 0, land_value: 0, income: 10_000, gain: 0, loan: 0 } }))!;
    expect(lo.amount).toBeLessThan(0);
  });
  it('taxable_fraction scales the base', () => {
    const ev = applyRule(rule({ kind: { type: 'flat', rate: 0.1 }, modifiers: { taxable_fraction: 0.7 } }), ctx())!;
    expect(ev.amount).toBeCloseTo(20_000 * 0.7 * 0.1, 6);
  });
  it('converts to USD with fx', () => {
    const ev = applyRule(rule({ kind: { type: 'flat', rate: 0.1 } }), ctx({ fx: 2 }))!;
    expect(ev.amountUsd).toBeCloseTo(1000, 6);
  });
});
