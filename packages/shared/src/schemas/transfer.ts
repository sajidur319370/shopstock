import { z } from 'zod';
import { BRANCH_CODE, LIMITS, TRANSFER_STATUSES } from '../constants';
import { objectIdSchema } from './common';

/** POST /b/:code/transfers: THIS branch is the source. Costs are not sent: they're set at dispatch. */
export const createTransferSchema = z.object({
  toBranchCode: z.string().trim().toUpperCase().regex(BRANCH_CODE, 'Invalid branch code'),
  lines: z
    .array(z.object({ productId: objectIdSchema, qty: z.number().int().min(1).max(LIMITS.maxDocQty) }))
    .min(1)
    .max(LIMITS.transferLines)
    .refine((a) => new Set(a.map((l) => l.productId)).size === a.length, 'Each product once'),
  note: z.string().trim().max(500).default(''),
});

export const transferListQuery = z.object({
  direction: z.enum(['incoming', 'outgoing', 'all']).default('all'),
  status: z.enum(TRANSFER_STATUSES).optional(),
  cursor: z.string().max(300).optional(),
});

export type CreateTransferInput = z.infer<typeof createTransferSchema>;
export type TransferListQuery = z.infer<typeof transferListQuery>;
