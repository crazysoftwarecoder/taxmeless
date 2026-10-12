import { z } from 'zod';
import { MetaSchema } from './meta';

export const AssumptionsSchema = z.object({
  principal_usd: z.number().positive(),
  horizon_years_default: z.number().int().min(1).max(40),
  equities: z.object({
    growth: z.number().min(-0.5).max(0.5),
    yield: z.number().min(0).max(0.5),
    /** Default share of dividends that carry imputation credits where a country has imputation. */
    franked_fraction: z.number().min(0).max(1),
    meta: MetaSchema,
  }),
  property: z.object({
    growth: z.number().min(-0.5).max(0.5),
    yield: z.number().min(0).max(0.5),
    /** Ongoing costs (maintenance, insurance, management, vacancy) as a fraction of gross rent. */
    cost_rate: z.number().min(0).max(1),
    /** Share of property value attributable to land (land tax base). */
    land_fraction: z.number().min(0).max(1),
    meta: MetaSchema,
  }),
});
export type Assumptions = z.infer<typeof AssumptionsSchema>;
