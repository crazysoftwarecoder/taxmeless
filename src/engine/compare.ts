import type { Asset, Assumptions, ColFile, CountriesFile, CountryCode, GdpFile, TaxFile } from '../../schemas';
import { combineLedgers } from './combine';
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
  /** With asset 'both': share of the capital put into equities (0..1); the rest goes to property. Default 0.5. */
  allocation?: number;
}

export function fxFor(dataset: Dataset, code: CountryCode): number {
  const c = dataset.countries.countries.find((x) => x.code === code);
  if (!c) throw new Error(`No country entry for ${code}`);
  return c.fx_to_usd.value;
}

/**
 * Run every selected country. A single asset gets all the capital. With 'both', the capital is split by
 * `allocation` and a combined 'portfolio' ledger is added (first) when both parts are non-empty.
 */
export function compareAll(inputs: CompareInputs, dataset: Dataset): Ledger[] {
  const out: Ledger[] = [];
  const w = Math.min(1, Math.max(0, inputs.allocation ?? 0.5));
  for (const code of inputs.countries) {
    const tax = dataset.tax[code];
    if (!tax) continue;
    const fx = fxFor(dataset, code);
    if (inputs.asset !== 'both') {
      out.push(simulate(inputs, tax, inputs.asset, dataset.assumptions, fx));
      continue;
    }
    const parts: Ledger[] = [];
    if (w > 0) parts.push(simulate({ ...inputs, principalUsd: inputs.principalUsd * w }, tax, 'equities', dataset.assumptions, fx));
    // Property income and gains stack on top of the equities' dividends and gains in the same tax years.
    const eq = parts[0];
    const incomeStackOffset = eq ? { growth: eq.rows.map((r) => r.stackedLocal.growth), egress: eq.rows.at(-1)!.stackedLocal.egress } : undefined;
    if (w < 1) parts.push(simulate({ ...inputs, principalUsd: inputs.principalUsd * (1 - w), incomeStackOffset }, tax, 'property', dataset.assumptions, fx));
    if (parts.length === 2) out.push(combineLedgers(parts[0]!, parts[1]!));
    out.push(...parts);
  }
  return out;
}
