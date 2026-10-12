import { z } from 'zod';

/** Provenance attached to every researched number and every rule. */
export const MetaSchema = z.object({
  source: z.string().regex(/^https:\/\//, 'source must be an https URL'),
  source_title: z.string().optional(),
  last_verified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'last_verified must be YYYY-MM-DD'),
  note: z.string().optional(),
});
export type Meta = z.infer<typeof MetaSchema>;

/** A number with provenance. */
export const ValuedSchema = z.object({ value: z.number().finite(), meta: MetaSchema });
export type Valued = z.infer<typeof ValuedSchema>;
