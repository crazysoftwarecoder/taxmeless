/** Loads and validates every data file at build time. The UI never reads raw JSON elsewhere. */
import {
  AssumptionsSchema, ColFileSchema, CountriesFileSchema, GdpFileSchema, TaxFileSchema,
  type ColFile, type CountryCode, type GdpFile, type TaxFile,
} from '../../schemas';
import type { Dataset } from '../engine/compare';
import countriesRaw from '../../data/countries.json';
import assumptionsRaw from '../../data/assumptions.json';

const taxRaw = import.meta.glob('../../data/tax/*.json', { eager: true, import: 'default' });
const gdpRaw = import.meta.glob('../../data/gdp/*.json', { eager: true, import: 'default' });
const colRaw = import.meta.glob('../../data/col/*.json', { eager: true, import: 'default' });

function parseAll<T extends { country: CountryCode }>(raw: Record<string, unknown>, parse: (x: unknown) => T): Partial<Record<CountryCode, T>> {
  const out: Partial<Record<CountryCode, T>> = {};
  for (const [path, value] of Object.entries(raw)) {
    try {
      const parsed = parse(value);
      out[parsed.country] = parsed;
    } catch (e) {
      console.error(`Invalid data file ${path}`, e);
    }
  }
  return out;
}

export const dataset: Dataset = {
  countries: CountriesFileSchema.parse(countriesRaw),
  assumptions: AssumptionsSchema.parse(assumptionsRaw),
  tax: parseAll<TaxFile>(taxRaw, (x) => TaxFileSchema.parse(x)),
  gdp: parseAll<GdpFile>(gdpRaw, (x) => GdpFileSchema.parse(x)),
  col: parseAll<ColFile>(colRaw, (x) => ColFileSchema.parse(x)),
};

/** Countries that have at least a tax file, in countries.json order. */
export const availableCountries = dataset.countries.countries.filter((c) => dataset.tax[c.code]);
