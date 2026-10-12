import { describe, expect, it } from 'vitest';
import type { Assumptions, TaxFile } from '../../../schemas';
import { simulate } from '../simulate';
import type { SimInputs } from '../types';

const meta = { source: 'https://example.org', last_verified: '2026-01-01' };
const assumptions: Assumptions = {
  principal_usd: 1_000_000,
  horizon_years_default: 10,
  equities: { growth: 0.07, yield: 0.02, franked_fraction: 0.7, meta },
  property: { growth: 0.05, yield: 0.035, cost_rate: 0.25, land_fraction: 0.6, meta },
};
const inputs: SimInputs = {
  horizonYears: 10,
  principalUsd: 1_000_000,
  equities: { growth: 0.07, yield: 0.02 },
  property: { growth: 0.05, yield: 0.035, costRate: 0.25 },
  otherIncomeBand: 'mid',
};

function taxFile(over: Partial<TaxFile> = {}): TaxFile {
  return {
    country: 'sg', currency: 'SGD', tax_year: '2026', jurisdiction_note: 'test', meta,
    resident_profile: { other_income_options: [50_000, 100_000, 300_000], meta },
    income_tax: { brackets: [{ from: 0, to: null, rate: 0 }], meta },
    levies: [],
    assets: {
      equities: { ingress: [], growth: [], egress: [] },
      property: { ingress: [], growth: [], egress: [] },
    },
    ...over,
  };
}

describe('simulate', () => {
  it('with no rules, net equals gross and compounds correctly', () => {
    const l = simulate(inputs, taxFile(), 'equities', assumptions, 1);
    expect(l.rows).toHaveLength(11);
    expect(l.finalNetUsd).toBeCloseTo(l.finalGrossUsd, 6);
    // value grows at 7% + 2% reinvested = 9% p.a.
    expect(l.finalNetUsd).toBeCloseTo(1_000_000 * Math.pow(1.09, 10), 0);
    expect(l.totalsUsd.taxes.all).toBe(0);
    expect(l.effectiveTaxRate).toBe(0);
  });
  it('zero-tax country with costs: net == gross, costs counted separately', () => {
    const t = taxFile({
      assets: {
        equities: {
          ingress: [{ id: 'brokerage', label: 'b', stage: 'ingress', category: 'cost', base: 'principal', kind: { type: 'flat', rate: 0.001 }, plain_english: 'brokerage fee for the test', meta }],
          growth: [], egress: [],
        },
        property: { ingress: [], growth: [], egress: [] },
      },
    });
    const l = simulate(inputs, t, 'equities', assumptions, 1);
    expect(l.finalNetUsd).toBeCloseTo(l.finalGrossUsd, 6);
    expect(l.totalsUsd.costs.ingress).toBeCloseTo(1000, 6);
    expect(l.totalsUsd.taxes.all).toBe(0);
    expect(l.rows[0]!.events[0]!.category).toBe('cost');
  });
  it('flat egress tax on gain reduces final value and is attributed to the last year', () => {
    const t = taxFile({
      assets: {
        equities: { ingress: [], growth: [], egress: [{ id: 'cgt', label: 'c', stage: 'egress', category: 'tax', base: 'gain', kind: { type: 'flat', rate: 0.2 }, plain_english: 'twenty percent on the gain', meta }] },
        property: { ingress: [], growth: [], egress: [] },
      },
    });
    const l = simulate(inputs, t, 'equities', assumptions, 1);
    // cost base = principal + reinvested net income (no growth taxes in this file)
    const costBase = 1_000_000 + l.rows.reduce((a, r) => a + r.incomeUsd, 0);
    const gain = l.finalGrossUsd - costBase;
    expect(l.totalsUsd.taxes.egress).toBeCloseTo(gain * 0.2, 2);
    expect(l.finalNetUsd).toBeCloseTo(l.finalGrossUsd - gain * 0.2, 2);
    expect(l.rows[10]!.taxesUsd.egress).toBeCloseTo(gain * 0.2, 2);
    expect(l.rows[9]!.taxesUsd.egress).toBe(0);
    expect(l.effectiveTaxRate).toBeCloseTo((gain * 0.2) / (l.finalGrossUsd - 1_000_000), 6);
  });
  it('property deducts running costs in both paths and applies land tax on land value', () => {
    const t = taxFile({
      assets: {
        equities: { ingress: [], growth: [], egress: [] },
        property: { ingress: [], growth: [{ id: 'land', label: 'l', stage: 'growth', category: 'tax', base: 'land_value', kind: { type: 'flat', rate: 0.01 }, plain_english: 'one percent of land value', meta }], egress: [] },
      },
    });
    const l = simulate(inputs, t, 'property', assumptions, 2);
    // year 1 land tax: opening 2m local × 0.6 × 1% = 12,000 local = 6,000 USD
    expect(l.rows[1]!.taxesUsd.growth).toBeCloseTo(6000, 6);
    // gross path year 1: 1m × 1.05 + 1m × 0.035 × 0.75
    expect(l.rows[1]!.grossValueUsd).toBeCloseTo(1_050_000 + 26_250, 6);
    expect(l.finalNetUsd).toBeLessThan(l.finalGrossUsd);
  });
  it('levies apply to both assets at their stage and income band selects other income', () => {
    const t = taxFile({
      levies: [{ id: 'lv', label: 'lv', stage: 'growth', category: 'tax', base: 'income', kind: { type: 'flat', rate: 0.02 }, modifiers: { applies_if_other_income_above: 200_000 }, plain_english: 'a levy only for high earners', meta }],
    });
    expect(simulate(inputs, t, 'equities', assumptions, 1).totalsUsd.taxes.all).toBe(0);
    expect(simulate({ ...inputs, otherIncomeBand: 'high' }, t, 'property', assumptions, 1).totalsUsd.taxes.all).toBeGreaterThan(0);
  });
  it('is deterministic and respects the horizon', () => {
    const a = simulate({ ...inputs, horizonYears: 25 }, taxFile(), 'equities', assumptions, 1);
    const b = simulate({ ...inputs, horizonYears: 25 }, taxFile(), 'equities', assumptions, 1);
    expect(a).toEqual(b);
    expect(a.rows).toHaveLength(26);
    expect(a.horizonYears).toBe(25);
  });
});
