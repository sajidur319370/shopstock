import { z } from 'zod';
import { ADJUSTMENT_REASONS, LIMITS, MOVEMENT_TYPES } from '../constants';
import { dateOnlySchema, moneySchema, objectIdSchema } from './common';

const uniqueProducts = <T extends { productId: string }>(a: T[]) =>
  new Set(a.map((l) => l.productId)).size === a.length;

export const adjustmentSchema = z.object({
  reason: z.enum(ADJUSTMENT_REASONS),
  note: z.string().trim().max(500).default(''),
  lines: z
    .array(
      z.object({
        productId: objectIdSchema,
        qtyChange: z
          .number()
          .int()
          .min(-LIMITS.maxDocQty)
          .max(LIMITS.maxDocQty)
          .refine((n) => n !== 0, 'Must not be 0'),
        unitCost: moneySchema.optional(),
      }),
    )
    .min(1)
    .max(LIMITS.adjustmentLines)
    .refine(uniqueProducts, 'Each product once'),
});

export const stockCountSchema = z.object({
  note: z.string().trim().max(500).default(''),
  lines: z
    .array(
      z.object({
        productId: objectIdSchema,
        expectedQty: z.number().int().min(0),
        countedQty: z.number().int().min(0).max(LIMITS.maxDocQty),
        unitCost: moneySchema.optional(),
      }),
    )
    .min(1)
    .max(LIMITS.adjustmentLines)
    .refine(uniqueProducts, 'Each product once'),
});

export const inventoryListQuery = z.object({
  categoryId: objectIdSchema.optional(),
  q: z.string().trim().max(60).optional(),
  cursor: z.string().max(300).optional(),
});

export const reorderLevelSchema = z.object({ reorderLevel: z.number().int().min(0).max(LIMITS.maxDocQty) });

export const movementQuery = z.object({
  productId: objectIdSchema.optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  cursor: z.string().max(300).optional(),
});

export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export type StockCountInput = z.infer<typeof stockCountSchema>;
export type InventoryListQuery = z.infer<typeof inventoryListQuery>;
export type MovementQuery = z.infer<typeof movementQuery>;
