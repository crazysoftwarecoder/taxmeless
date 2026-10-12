import type { Asset, Assumptions, ColFile, CountriesFile, CountryCode, GdpFile, TaxFile } from '../../schemas';
import { simulate } from './simulate';
import type { Ledger, SimInputs } from './types';

export interface Dataset {
  countries: CountriesFile;
  assumptions: Assumptions;
  tax: Partial<Record<CountryCode, TaxFile>>;
  gdp: Partial<Record<CountryCode, GdpFile>>;
  col: Partial<Record<CountryCode, ColFile>>;
}

export type AssetChoice = Asset | 'both';

export interface CompareInputs extends SimInputs {
  countries: CountryCode[];
  asset: AssetChoice;
}

export function fxFor(dataset: Dataset, code: CountryCode): number {
  const c = dataset.countries.countries.find((x) => x.code === code);
  if (!c) throw new Error(`No country entry for ${code}`);
  return c.fx_to_usd.value;
}

/** Run every selected country × asset. Countries without a tax file are skipped. */
export function compareAll(inputs: CompareInputs, dataset: Dataset): Ledger[] {
  const assets: Asset[] = inputs.asset === 'both' ? ['equities', 'property'] : [inputs.asset];
  const out: Ledger[] = [];
  for (const code of inputs.countries) {
    const tax = dataset.tax[code];
    if (!tax) continue;
    const fx = fxFor(dataset, code);
    for (const asset of assets) out.push(simulate(inputs, tax, asset, dataset.assumptions, fx));
  }
  return out;
}
