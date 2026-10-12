import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AssumptionsSchema, CountriesFileSchema, TaxFileSchema } from '../../../schemas';
import { compareAll, type CompareInputs, type Dataset } from '../compare';
import { simulate } from '../simulate';

const root = join(import.meta.dirname, '../../..');
const read = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const dataset: Dataset = {
  countries: CountriesFileSchema.parse(read('data/countries.json')),
  assumptions: AssumptionsSchema.parse(read('data/assumptions.json')),
  tax: { au: TaxFileSchema.parse(read('data/tax/au.json')), sg: TaxFileSchema.parse(read('data/tax/sg.json')) },
  gdp: {}, col: {},
};
const inputs: CompareInputs = {
  countries: ['au', 'sg'], asset: 'both', allocation: 0.3, horizonYears: 15, principalUsd: 1_000_000,
  equities: { growth: 0.07, yield: 0.02 }, property: { growth: 0.05, yield: 0.035, costRate: 0.25 },
  otherIncomeBand: 'mid', startDate: '2026-10-12', inflation: 0.025,
};

describe('capital allocation', () => {
  it('splits capital and adds a portfolio ledger first', () => {
    const ls = compareAll(inputs, dataset);
    expect(ls.map((l) => `${l.country}:${l.asset}`)).toEqual(['au:portfolio', 'au:equities', 'au:property', 'sg:portfolio', 'sg:equities', 'sg:property']);
    const [port, eq, pr] = ls;
    expect(eq!.principalUsd).toBeCloseTo(300_000, 6);
    expect(pr!.principalUsd).toBeCloseTo(700_000, 6);
    expect(port!.principalUsd).toBeCloseTo(1_000_000, 6);
    expect(port!.finalNetUsd).toBeCloseTo(eq!.finalNetUsd + pr!.finalNetUsd, 6);
    expect(port!.totalsUsd.taxes.all).toBeCloseTo(eq!.totalsUsd.taxes.all + pr!.totalsUsd.taxes.all, 6);
    expect(port!.rows[15]!.events.length).toBe(eq!.rows[15]!.events.length + pr!.rows[15]!.events.length);
    expect(port!.rows[15]!.events.every((e) => /^(equities|property):/.test(e.ruleId))).toBe(true);
  });
  it('a part matches simulating that asset alone with its share', () => {
    const [, eq] = compareAll(inputs, dataset);
    const alone = simulate({ ...inputs, principalUsd: 300_000 }, dataset.tax.au!, 'equities', dataset.assumptions, dataset.countries.countries.find((c) => c.code === 'au')!.fx_to_usd.value);
    expect(eq!.finalNetUsd).toBeCloseTo(alone.finalNetUsd, 6);
  });
  it('property income stacks on the equities income in the same years (progressive brackets)', () => {
    const [, eq, pr] = compareAll(inputs, dataset);
    const fx = dataset.countries.countries.find((c) => c.code === 'au')!.fx_to_usd.value;
    const alone = simulate({ ...inputs, principalUsd: 700_000 }, dataset.tax.au!, 'property', dataset.assumptions, fx);
    expect(eq!.rows[15]!.stackedLocal.egress).toBeGreaterThan(0);
    expect(pr!.totalsUsd.taxes.all).toBeGreaterThan(alone.totalsUsd.taxes.all);
    // Singapore exempts dividends and gains, so nothing stacks and the property half is unchanged
    const sgPr = compareAll({ ...inputs, countries: ['sg'] }, dataset)[2]!;
    const sgAlone = simulate({ ...inputs, principalUsd: 700_000 }, dataset.tax.sg!, 'property', dataset.assumptions, dataset.countries.countries.find((c) => c.code === 'sg')!.fx_to_usd.value);
    expect(sgPr.finalNetUsd).toBeCloseTo(sgAlone.finalNetUsd, 6);
  });
  it('0% or 100% drops the empty side and the portfolio', () => {
    expect(compareAll({ ...inputs, allocation: 1 }, dataset).map((l) => l.asset)).toEqual(['equities', 'equities']);
    expect(compareAll({ ...inputs, allocation: 0 }, dataset).map((l) => l.asset)).toEqual(['property', 'property']);
  });
  it('single-asset choice still gets all the capital', () => {
    const ls = compareAll({ ...inputs, asset: 'equities' }, dataset);
    expect(ls.every((l) => l.principalUsd === 1_000_000)).toBe(true);
  });
});
