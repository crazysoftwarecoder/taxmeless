import { describe, expect, it } from 'vitest';
import type { Assumptions, Rule, TaxFile } from '../../../schemas';
import { simulate } from '../simulate';
import type { SimInputs } from '../types';

const meta = { source: 'https://example.org', last_verified: '2026-01-01' };
const assumptions: Assumptions = {
  principal_usd: 1_000_000, horizon_years_default: 10,
  equities: { growth: 0.07, yield: 0.02, franked_fraction: 0.7, meta },
  property: { growth: 0.05, yield: 0.035, cost_rate: 0.25, land_fraction: 0.6, meta },
};
const inputs: SimInputs = {
  horizonYears: 10, principalUsd: 1_000_000, equities: { growth: 0.07, yield: 0.02 },
  property: { growth: 0.05, yield: 0.035, costRate: 0.25 }, otherIncomeBand: 'mid', startDate: '2026-07-01', inflation: 0.025,
};
const sched = (group?: string): Rule['kind'] => ({
  type: 'schedule', stack_on_other_income: true, ...(group ? { stack_group: group } : {}),
  schedule: { brackets: [{ from: 0, to: 120_000, rate: 0 }, { from: 120_000, to: null, rate: 0.5 }], meta },
});
const file = (growth: Rule[]): TaxFile => ({
  country: 'us-ca', currency: 'USD', tax_year: '2026', jurisdiction_note: 'test', meta,
  resident_profile: { other_income_options: [0, 100_000, 200_000], meta },
  income_tax: { brackets: [{ from: 0, to: null, rate: 0 }], meta }, levies: [],
  assets: { equities: { ingress: [], growth, egress: [] }, property: { ingress: [], growth, egress: [] } },
  property_leverage: { interest_deductible: true, rental_loss: [{ treatment: 'offset_other_income' }], plain_english: 'policy text for tests', meta },
});
const r = (id: string, kind: Rule['kind']): Rule => ({ id, label: id, stage: 'growth', category: 'tax', base: 'income', kind, plain_english: 'a rule used in tests', meta });

describe('stack groups', () => {
  it('a state tax on the same dividend stacks only on its own system', () => {
    // dividend 20,000 on 100,000 other income: each system taxes 0 to 120k at 0%, so only nothing is taxed
    const separate = simulate(inputs, file([r('fed', sched('federal')), r('state', sched('state'))]), 'equities', assumptions, 1);
    expect(separate.rows[1]!.taxesUsd.growth).toBe(0);
    // without groups the second rule would see the first one's 20k and be pushed into the 50% band
    const shared = simulate(inputs, file([r('a', sched()), r('b', sched())]), 'equities', assumptions, 1);
    expect(shared.rows[1]!.taxesUsd.growth).toBeGreaterThan(0);
  });
});

describe('assessed value cap (Prop 13)', () => {
  it('taxes the purchase price grown by at most the cap', () => {
    const tax: Rule = { id: 'prop', label: 'prop', stage: 'growth', category: 'tax', base: 'principal', kind: { type: 'flat', rate: 0.01 }, modifiers: { assessed_growth_cap: 0.02 }, plain_english: 'property tax used in tests', meta };
    const l = simulate(inputs, file([tax]), 'property', assumptions, 1);
    expect(l.rows[1]!.events.find((e) => e.ruleId === 'prop')!.base).toBeCloseTo(1_000_000, 2);
    expect(l.rows[10]!.events.find((e) => e.ruleId === 'prop')!.base).toBeCloseTo(1_000_000 * 1.02 ** 9, 2);
  });
  it('never exceeds market value', () => {
    const tax: Rule = { id: 'prop', label: 'prop', stage: 'growth', category: 'tax', base: 'principal', kind: { type: 'flat', rate: 0.01 }, modifiers: { assessed_growth_cap: 0.5 }, plain_english: 'property tax used in tests', meta };
    const l = simulate(inputs, file([tax]), 'property', assumptions, 1);
    const e = l.rows[3]!.events.find((x) => x.ruleId === 'prop')!;
    expect(e.base).toBeLessThanOrEqual(l.purchasePriceUsd * 1.05 ** 3 + 1);
  });
});
