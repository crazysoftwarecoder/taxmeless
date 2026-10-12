import { describe, expect, it } from 'vitest';
import type { Assumptions, PropertyLeverage, Rule, TaxFile } from '../../../schemas';
import { simulate } from '../simulate';
import type { SimInputs } from '../types';

const meta = { source: 'https://example.org', last_verified: '2026-01-01' };
const assumptions: Assumptions = {
  principal_usd: 1_000_000, horizon_years_default: 10,
  equities: { growth: 0.07, yield: 0.02, franked_fraction: 0.7, meta },
  property: { growth: 0.05, yield: 0.035, cost_rate: 0.25, land_fraction: 0.6, meta },
};
const base: SimInputs = {
  horizonYears: 10, principalUsd: 1_000_000, equities: { growth: 0.07, yield: 0.02 },
  property: { growth: 0.05, yield: 0.035, costRate: 0.25, lvr: 0.6, interestRate: 0.06 },
  otherIncomeBand: 'mid', startDate: '2026-07-01', inflation: 0.025,
};
const rentTax: Rule = {
  id: 'rent', label: 'rent', stage: 'growth', category: 'tax', base: 'income',
  kind: { type: 'schedule', schedule: { $ref: 'income_tax' }, stack_on_other_income: true }, plain_english: 'tax on net rent for tests', meta,
};
const cgt: Rule = { id: 'cgt', label: 'cgt', stage: 'egress', category: 'tax', base: 'gain', kind: { type: 'flat', rate: 0.3 }, plain_english: 'flat gain tax for tests', meta };
const file = (policy: Partial<PropertyLeverage>, extra: Partial<TaxFile> = {}): TaxFile => ({
  country: 'au', currency: 'AUD', tax_year: '2026', jurisdiction_note: 'test', meta,
  resident_profile: { other_income_options: [50_000, 150_000, 300_000], meta },
  income_tax: { brackets: [{ from: 0, to: null, rate: 0.4 }], meta }, levies: [],
  assets: { equities: { ingress: [], growth: [], egress: [] }, property: { ingress: [], growth: [rentTax], egress: [cgt] } },
  property_leverage: { interest_deductible: true, rental_loss: [{ treatment: 'offset_other_income' }], plain_english: 'policy text for tests', meta, ...policy },
  ...extra,
});

describe('leverage', () => {
  it('buys a bigger property with the same cash and charges interest', () => {
    const l = simulate(base, file({}), 'property', assumptions, 1);
    expect(l.purchasePriceUsd).toBeCloseTo(2_500_000, 0);
    expect(l.loanUsd).toBeCloseTo(1_500_000, 0);
    const interest = l.rows[1]!.events.find((e) => e.label === 'Mortgage interest')!;
    expect(interest.amount).toBeCloseTo(90_000, 0);
    expect(l.rows[0]!.netValueUsd).toBeCloseTo(1_000_000, 0);
  });
  it('LVR 0 matches the unleveraged result', () => {
    const a = simulate({ ...base, property: { ...base.property, lvr: 0 } }, file({}), 'property', assumptions, 1);
    const b = simulate({ ...base, property: { growth: 0.05, yield: 0.035, costRate: 0.25 } }, file({}), 'property', assumptions, 1);
    expect(a.finalNetUsd).toBeCloseTo(b.finalNetUsd, 6);
    expect(a.loanUsd).toBe(0);
  });
  it('negative gearing: a loss offsets other income as a refund', () => {
    const l = simulate(base, file({}), 'property', assumptions, 1);
    // rent 2.5m*3.5%*0.75 = 65,625; interest 90,000 → loss 24,375 → refund at 40%
    expect(l.rows[1]!.taxesUsd.growth).toBeCloseTo(-24_375 * 0.4, 0);
  });
  it('ring-fenced losses carry forward and reduce the gain when allowed', () => {
    const ring = simulate(base, file({ rental_loss: [{ treatment: 'carry_forward_incl_gains' }] }), 'property', assumptions, 1);
    expect(ring.rows[1]!.taxesUsd.growth).toBe(0);
    expect(ring.rows[1]!.events.some((e) => e.label === 'Rental loss carried forward')).toBe(true);
    const used = ring.rows[10]!.events.find((e) => e.label.startsWith('Carried-forward rental losses used'));
    expect(used).toBeDefined();
    const lapse = simulate(base, file({ rental_loss: [{ treatment: 'lapse' }] }), 'property', assumptions, 1);
    expect(lapse.totalsUsd.taxes.egress).toBeGreaterThan(ring.totalsUsd.taxes.egress);
  });
  it('dated loss treatment switches from offset to quarantine', () => {
    const l = simulate({ ...base, startDate: '2026-01-01' }, file({ rental_loss: [{ treatment: 'offset_other_income' }, { effective_from: '2027-07-01', treatment: 'carry_forward' }] }), 'property', assumptions, 1);
    expect(l.rows[1]!.taxesUsd.growth).toBeCloseTo(-24_375 * 0.4, 0); // 2027-01-01: still offset
    expect(l.rows[2]!.taxesUsd.growth).toBe(0); // 2028-01-01: quarantined
  });
  it('UK-style credit: interest not deducted, 20% credit limited to profit', () => {
    const l = simulate({ ...base, property: { ...base.property, lvr: 0.3 } }, file({ interest_deductible: false, finance_cost_credit_rate: 0.2 }), 'property', assumptions, 1);
    const y1 = l.rows[1]!.events;
    const credit = y1.find((e) => e.label === 'Finance cost tax credit')!;
    const rent = y1.find((e) => e.ruleId === 'rent')!;
    const interest = y1.find((e) => e.label === 'Mortgage interest')!.amount;
    expect(rent.base).toBeCloseTo(l.purchasePriceUsd * 0.035 * 0.75, 0); // gross of interest
    expect(credit.amount).toBeCloseTo(-0.2 * Math.min(interest, rent.base), 2);
  });
  it('negative cash flow is paid from your pocket, not added to the cost base', () => {
    const l = simulate({ ...base, property: { ...base.property, lvr: 0.8 } }, file({ rental_loss: [{ treatment: 'lapse' }] }), 'property', assumptions, 1);
    // price 5m, loan 4m: rent 131,250 − interest 240,000 = −108,750 paid in; growth 250,000
    expect(l.rows[1]!.netValueUsd).toBeCloseTo(1_000_000 + 250_000 - 108_750, 0);
    // the shortfall is not capitalised: the asset is worth exactly 5m × 1.05 after year 1
    expect(l.rows[1]!.netValueUsd + l.loanUsd + 108_750).toBeCloseTo(5_000_000 * 1.05, 0);
  });
});
