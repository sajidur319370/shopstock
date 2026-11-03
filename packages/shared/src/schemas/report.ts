import { z } from 'zod';
import { LIMITS } from '../constants';
import { dateOnlySchema, objectIdSchema } from './common';

/** `branchIds=a,b`, `branchIds=a&branchIds=b`, or missing (= all my branches). */
const branchIds = z.preprocess(
  (v) => (v === undefined || v === '' ? [] : Array.isArray(v) ? v : String(v).split(',')),
  z.array(objectIdSchema).max(LIMITS.branches),
);

/**
 * `from ≤ to` and ≤ 366 days is checked in the service: it has its own code (INVALID_DATE_RANGE),
 * which a Zod refine would turn into a generic VALIDATION_ERROR.
 */
export const periodQuery = z.object({ from: dateOnlySchema, to: dateOnlySchema, branchIds });

export const bestSellersQuery = periodQuery.extend({
  sortBy: z.enum(['qty', 'revenue', 'profit']).default('qty'),
  limit: z.coerce.number().int().min(10).max(100).default(20),
  categoryId: objectIdSchema.optional(),
});

export const monthlyQuery = z.object({
  months: z.coerce.number().int().min(1).max(LIMITS.reportMaxMonths).default(12),
  branchIds,
});

export type PeriodQuery = z.infer<typeof periodQuery>;
export type BestSellersQuery = z.infer<typeof bestSellersQuery>;
export type MonthlyQuery = z.infer<typeof monthlyQuery>;
