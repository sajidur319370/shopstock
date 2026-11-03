import { z } from 'zod';
import { LIMITS, PAYMENT_METHODS, RETURN_REASONS } from '../constants';
import { dateOnlySchema, objectIdSchema, uuidSchema } from './common';

/**
 * POST /b/:code/returns. No amounts: the server computes every refund from the stored sale line
 * (telescoping portions), so the client can't ask for more than the customer paid.
 */
export const createReturnSchema = z
  .object({
    clientReturnId: uuidSchema, // idempotency key, like clientSaleId
    saleId: objectIdSchema,
    lines: z
      .array(
        z.object({
          saleLineId: objectIdSchema,
          qty: z.number().int().min(1).max(LIMITS.maxLineQty),
          restock: z.boolean(), // false = written off (damaged, expired): no stock change
        }),
      )
      .min(1)
      .max(LIMITS.returnLines),
    reason: z.enum(RETURN_REASONS),
    note: z.string().trim().max(500).default(''),
    refundMethod: z.enum(PAYMENT_METHODS).optional(), // default: the sale's first payment method
  })
  .refine((o) => o.reason !== 'other' || o.note.length > 0, {
    path: ['note'],
    message: 'Explain the reason',
  });

export const returnsListQuery = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  invoiceNo: z.string().trim().max(20).optional(),
  cursor: z.string().max(300).optional(),
});

export type CreateReturnInput = z.infer<typeof createReturnSchema>;
export type ReturnsListQuery = z.infer<typeof returnsListQuery>;
