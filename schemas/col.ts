import { z } from 'zod';
import { MetaSchema, ValuedSchema } from './meta';
import { CountryCodeSchema } from './tax';

export const ColCategoriesSchema = z.object({
  housing_rent: ValuedSchema,
  food: ValuedSchema,
  transport: ValuedSchema,
  childcare_education: ValuedSchema,
  healthcare: ValuedSchema,
  utilities: ValuedSchema,
  other: ValuedSchema,
});
export type ColCategories = z.infer<typeof ColCategoriesSchema>;
export const COL_CATEGORY_KEYS = ColCategoriesSchema.keyof().options;

export const ColFileSchema = z.object({
  country: CountryCodeSchema,
  household: z.literal('2 adults + 2 children'),
  city: z.string().min(1),
  currency: z.string().length(3),
  base_year: z.number().int().min(2015).max(2100),
  /** Annual amounts in local currency. */
  categories: ColCategoriesSchema,
  inflation: z.object({ cpi_assumed: z.number().min(-0.05).max(0.5), meta: MetaSchema }),
  median_household_income: ValuedSchema.optional(),
  meta: MetaSchema,
});
export type ColFile = z.infer<typeof ColFileSchema>;
