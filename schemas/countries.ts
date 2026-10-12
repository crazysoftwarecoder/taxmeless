import { z } from 'zod';
import { MetaSchema } from './meta';
import { CountryCodeSchema } from './tax';

export const CountrySchema = z.object({
  code: CountryCodeSchema,
  iso3: z.string().length(3),
  name: z.string().min(1),
  currency: z.string().length(3),
  /** Units of local currency per 1 USD. */
  fx_to_usd: z.object({ value: z.number().positive(), meta: MetaSchema }),
});
export type Country = z.infer<typeof CountrySchema>;

export const CountriesFileSchema = z.object({ countries: z.array(CountrySchema).min(1) });
export type CountriesFile = z.infer<typeof CountriesFileSchema>;
