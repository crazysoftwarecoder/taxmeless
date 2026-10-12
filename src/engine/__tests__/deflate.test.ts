import { describe, expect, it } from 'vitest';
import { deflateLedger } from '../deflate';
import type { Ledger } from '../types';

const z = { ingress: 0, growth: 0, egress: 0 };
const row = (year: number, net: number, tax = 0) => ({
  year, openingValueUsd: net, incomeUsd: 0, growthUsd: 0, taxesUsd: { ...z, growth: tax }, costsUsd: z, events: [], grossValueUsd: net + tax, netValueUsd: net, stackedLocal: { growth: {}, egress: {} },
});
const ledger: Ledger = {
  country: 'au', asset: 'equities', currency: 'AUD', fx: 1, principalUsd: 100, horizonYears: 2, purchasePriceUsd: 100, loanUsd: 0,
  rows: [row(0, 100), row(1, 110, 10), row(2, 121, 10)],
  totalsUsd: { taxes: { ...z, growth: 20, all: 20 }, costs: { ...z, all: 0 } },
  finalGrossUsd: 131, finalNetUsd: 121, effectiveTaxRate: 20 / 31, dragPct: 0,
};

describe('deflateLedger', () => {
  it('is identity at 0%', () => { expect(deflateLedger(ledger, 0)).toBe(ledger); });
  it('discounts each year and recomputes totals', () => {
    const d = deflateLedger(ledger, 0.1);
    expect(d.rows[0]!.netValueUsd).toBe(100);
    expect(d.finalNetUsd).toBeCloseTo(100, 6);
    expect(d.totalsUsd.taxes.all).toBeCloseTo(10 / 1.1 + 10 / 1.21, 6);
    expect(d.effectiveTaxRate).toBeCloseTo(d.totalsUsd.taxes.all / (131 / 1.21 - 100), 6);
  });
});
