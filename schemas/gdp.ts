import { z } from 'zod';
import { MetaSchema, ValuedSchema } from './meta';
import { CountryCodeSchema } from './tax';

export const PointSchema = z.object({ year: z.number().int().min(1960).max(2100), value: z.number().finite().min(0) });
export type Point = z.infer<typeof PointSchema>;

export const GdpFileSchema = z.object({
  country: CountryCodeSchema,
  indicator: z.string().min(1),
  unit: z.literal('USD'),
  series: z.array(PointSchema).min(10),
  projection: z.object({
    method: z.enum(['cagr_last_10y', 'manual']),
    cagr: z.number().finite().optional(),
    meta: MetaSchema,
  }),
  median_household_income: ValuedSchema.extend({ currency: z.string().length(3) }).optional(),
  meta: MetaSchema,
});
export type GdpFile = z.infer<typeof GdpFileSchema>;
