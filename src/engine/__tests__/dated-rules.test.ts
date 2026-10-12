import { describe, expect, it } from 'vitest';
import type { Assumptions, Rule, TaxFile } from '../../../schemas';
import { addYears, scheduleOn, simulate, yearsBetween } from '../simulate';
import type { SimInputs } from '../types';

const meta = { source: 'https://example.org', last_verified: '2026-01-01' };
const assumptions: Assumptions = {
  principal_usd: 1_000_000, horizon_years_default: 10,
  equities: { growth: 0.07, yield: 0, franked_fraction: 0.7, meta },
  property: { growth: 0.05, yield: 0, cost_rate: 0, land_fraction: 0.6, meta },
};
const inputs: SimInputs = {
  horizonYears: 10, principalUsd: 1_000_000, equities: { growth: 0.07, yield: 0 }, property: { growth: 0.05, yield: 0, costRate: 0 },
  otherIncomeBand: 'mid', startDate: '2026-07-01', inflation: 0.025,
};
const flat = (rate: number) => ({ brackets: [{ from: 0, to: null, rate }], meta });
const rule = (over: Partial<Rule>): Rule => ({
  id: 'cgt', label: 'cgt', stage: 'egress', category: 'tax', base: 'gain', kind: { type: 'flat', rate: 0.5 },
  plain_english: 'a test capital gains rule', meta, ...over,
});
const file = (egress: Rule[], over: Partial<TaxFile> = {}): TaxFile => ({
  country: 'au', currency: 'AUD', tax_year: '2026-27', jurisdiction_note: 'test', meta,
  resident_profile: { other_income_options: [0, 0, 0], meta },
  income_tax: flat(0.4), levies: [], property_leverage: { interest_deductible: true, rental_loss: [{ treatment: 'offset_other_income' }], plain_english: 'test leverage policy text', meta },
  assets: { equities: { ingress: [], growth: [], egress }, property: { ingress: [], growth: [], egress: [] } },
  ...over,
});

describe('dates', () => {
  it('adds and measures years', () => {
    expect(addYears('2026-07-01', 1)).toBe('2027-07-01');
    expect(yearsBetween('2026-07-01', '2027-07-01')).toBeCloseTo(1, 2);
  });
  it('picks the schedule in force on a date', () => {
    const t = file([], { income_tax_changes: [{ effective_from: '2027-07-01', schedule: flat(0.3) }] });
    expect(scheduleOn(t, '2027-06-30').brackets[0]!.rate).toBe(0.4);
    expect(scheduleOn(t, '2027-07-01').brackets[0]!.rate).toBe(0.3);
  });
});

describe('accrual windows', () => {
  const full = simulate(inputs, file([rule({})]), 'equities', assumptions, 1);
  const totalGain = full.finalGrossUsd - 1_000_000;
  it('pre + post windows sum to the whole gain', () => {
    const split = simulate(inputs, file([rule({ id: 'pre', modifiers: { accrual_until: '2028-07-01' } }), rule({ id: 'post', modifiers: { accrual_from: '2028-07-01' } })]), 'equities', assumptions, 1);
    const ev = split.rows[10]!.events;
    expect(ev).toHaveLength(2);
    expect(ev[0]!.base + ev[1]!.base).toBeCloseTo(totalGain, 0);
    // pre-window = 2 years of 7% growth
    // 2026-07-01 → 2028-07-01 is ~2 years (leap day makes it 2.001)
    expect(Math.abs(ev[0]!.base / (1_000_000 * (1.07 ** 2 - 1)) - 1)).toBeLessThan(0.002);
    expect(split.totalsUsd.taxes.egress).toBeCloseTo(full.totalsUsd.taxes.egress, 0);
  });
  it('window entirely before purchase taxes nothing', () => {
    const l = simulate(inputs, file([rule({ modifiers: { accrual_until: '2020-01-01' } })]), 'equities', assumptions, 1);
    expect(l.totalsUsd.taxes.all).toBe(0);
  });
  it('indexation removes the CPI component of the cost base', () => {
    const l = simulate(inputs, file([rule({ kind: { type: 'flat', rate: 1 }, modifiers: { cost_base_indexation: true } })]), 'equities', assumptions, 1);
    const e = l.rows[10]!.events[0]!;
    expect(e.taxable).toBeCloseTo(totalGain - 1_000_000 * (1.025 ** 10 - 1), 0);
  });
  it('a negative real gain produces no tax', () => {
    const lowGrowth = { ...inputs, equities: { growth: 0.02, yield: 0 } };
    const l = simulate(lowGrowth, file([rule({ modifiers: { cost_base_indexation: true } })]), 'equities', assumptions, 1);
    expect(l.totalsUsd.taxes.all).toBe(0);
  });
});

describe('minimum rate and dated rules', () => {
  it('lifts tax to the minimum rate', () => {
    const l = simulate(inputs, file([rule({ kind: { type: 'flat', rate: 0.1 }, modifiers: { minimum_rate: 0.3 } })]), 'equities', assumptions, 1);
    const e = l.rows[10]!.events[0]!;
    expect(e.amount).toBeCloseTo(e.taxable * 0.3, 4);
  });
  it('does not lower tax that is already above the minimum', () => {
    const l = simulate(inputs, file([rule({ kind: { type: 'flat', rate: 0.45 }, modifiers: { minimum_rate: 0.3 } })]), 'equities', assumptions, 1);
    const e = l.rows[10]!.events[0]!;
    expect(e.amount).toBeCloseTo(e.taxable * 0.45, 4);
  });
  it('effective_from / effective_until gate by event date', () => {
    const before = simulate({ ...inputs, horizonYears: 1 }, file([rule({ modifiers: { effective_from: '2028-01-01' } })]), 'equities', assumptions, 1);
    const after = simulate({ ...inputs, horizonYears: 3 }, file([rule({ modifiers: { effective_from: '2028-01-01' } })]), 'equities', assumptions, 1);
    expect(before.totalsUsd.taxes.all).toBe(0);
    expect(after.totalsUsd.taxes.all).toBeGreaterThan(0);
    const until = simulate({ ...inputs, horizonYears: 3 }, file([rule({ modifiers: { effective_until: '2028-01-01' } })]), 'equities', assumptions, 1);
    expect(until.totalsUsd.taxes.all).toBe(0);
  });
  it('stacks successive income-tax rules on each other', () => {
    const t = file([
      rule({ id: 'a', kind: { type: 'schedule', schedule: { $ref: 'income_tax' }, stack_on_other_income: true }, modifiers: { accrual_until: '2028-07-01' } }),
      rule({ id: 'b', kind: { type: 'schedule', schedule: { $ref: 'income_tax' }, stack_on_other_income: true }, modifiers: { accrual_from: '2028-07-01' } }),
    ], { income_tax: { brackets: [{ from: 0, to: 100_000, rate: 0 }, { from: 100_000, to: null, rate: 0.5 }], meta } });
    const l = simulate(inputs, t, 'equities', assumptions, 1);
    const totalGain = l.finalGrossUsd - 1_000_000;
    // one 100k zero-rate band shared across both rules, not one per rule
    expect(l.totalsUsd.taxes.egress).toBeCloseTo((totalGain - 100_000) * 0.5, 0);
  });
});
