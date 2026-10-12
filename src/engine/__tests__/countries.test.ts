/** Invariants over every real data/tax file present. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AssumptionsSchema, CountriesFileSchema, TaxFileSchema } from '../../../schemas';
import { simulate } from '../simulate';

const root = join(import.meta.dirname, '../../..');
const assumptions = AssumptionsSchema.parse(JSON.parse(readFileSync(join(root, 'data/assumptions.json'), 'utf8')));
const countries = CountriesFileSchema.parse(JSON.parse(readFileSync(join(root, 'data/countries.json'), 'utf8')));
const files = readdirSync(join(root, 'data/tax')).filter((f) => f.endsWith('.json'));

describe.each(files)('data/tax/%s', (file) => {
  const tax = TaxFileSchema.parse(JSON.parse(readFileSync(join(root, 'data/tax', file), 'utf8')));
  const fx = countries.countries.find((c) => c.code === tax.country)!.fx_to_usd.value;
  const inputs = {
    principalUsd: assumptions.principal_usd,
    equities: { growth: assumptions.equities.growth, yield: assumptions.equities.yield },
    property: { growth: assumptions.property.growth, yield: assumptions.property.yield, costRate: assumptions.property.cost_rate },
  };
  for (const asset of ['equities', 'property'] as const) {
    for (const band of ['low', 'mid', 'high'] as const) {
      it(`${asset}/${band}: finite, net ≤ gross, positive, monotone horizon`, () => {
        const l10 = simulate({ ...inputs, horizonYears: 10, otherIncomeBand: band }, tax, asset, assumptions, fx);
        const l25 = simulate({ ...inputs, horizonYears: 25, otherIncomeBand: band }, tax, asset, assumptions, fx);
        for (const l of [l10, l25]) {
          expect(l.rows.every((r) => Number.isFinite(r.netValueUsd) && Number.isFinite(r.grossValueUsd))).toBe(true);
          expect(l.finalNetUsd).toBeLessThanOrEqual(l.finalGrossUsd + 1e-6);
          expect(l.finalNetUsd).toBeGreaterThan(0);
          expect(l.effectiveTaxRate).toBeGreaterThanOrEqual(-0.05);
          expect(l.effectiveTaxRate).toBeLessThan(0.8);
        }
        expect(l25.finalNetUsd).toBeGreaterThan(l10.finalNetUsd);
      });
    }
  }
  it('every tax-category event has an https source and plain English', () => {
    const l = simulate({ ...inputs, horizonYears: 10, otherIncomeBand: 'mid' }, tax, 'property', assumptions, fx);
    for (const r of l.rows) for (const e of r.events) {
      expect(e.meta.source.startsWith('https://')).toBe(true);
      expect(e.explanation.length).toBeGreaterThan(20);
    }
  });
});
