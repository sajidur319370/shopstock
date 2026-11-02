import { z } from 'zod';
import { LIMITS, PAYMENT_METHODS, SALE_RETURN_STATUSES } from '../constants';
import { bpsSchema, dateOnlySchema, moneySchema, objectIdSchema, uuidSchema } from './common';

export const discountSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('percent'), bps: bpsSchema }),
  z.object({ type: z.literal('amount'), amount: moneySchema }),
]);

export const paymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: z.number().int().min(1).max(LIMITS.maxMoney),
  reference: z.string().trim().max(60).optional(),
});

/**
 * POST /b/:code/sales. NO PRICES: if a client sends unitPrice, Zod strips it (unknown keys are
 * dropped). FR-PRC-03 is enforced by the field's ABSENCE. Duplicate products aren't rejected here:
 * the service returns the specific DUPLICATE_LINE code (Day 11).
 */
export const createSaleSchema = z.object({
  clientSaleId: uuidSchema, // idempotency key: the same key twice = the same attempt
  lines: z
    .array(
      z.object({
        productId: objectIdSchema,
        qty: z.number().int().min(1).max(LIMITS.maxLineQty),
        discount: discountSchema.nullish(),
      }),
    )
    .min(1)
    .max(LIMITS.saleLines),
  discount: discountSchema.nullish(),
  payments: z.array(paymentSchema).min(1).max(LIMITS.payments),
  customer: z
    .object({ name: z.string().trim().max(60).default(''), phone: z.string().trim().max(20).default('') })
    .optional(),
  note: z.string().trim().max(200).optional(),
  expectedTotal: z.number().int().min(0).optional(), // FR-PRC-06: what the cashier saw
});

export const salesListQuery = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  cashierId: objectIdSchema.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  returnStatus: z.enum(SALE_RETURN_STATUSES).optional(),
  invoiceNo: z.string().trim().max(20).optional(),
  cursor: z.string().max(300).optional(),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;
export type SalesListQuery = z.infer<typeof salesListQuery>;
