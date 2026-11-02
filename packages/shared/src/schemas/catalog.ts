import { z } from 'zod';
import { BARCODE, LIMITS, SKU, UNITS } from '../constants';
import { objectIdSchema } from './common';

export const categoryNameSchema = z.string().trim().min(1).max(40);
export const createCategorySchema = z.object({ name: categoryNameSchema });

export const skuSchema = z.string().trim().toUpperCase().regex(SKU, 'Letters, digits, . _ - (2–32)');
export const barcodeSchema = z.string().trim().regex(BARCODE, '4–32 letters, digits or -');
/** A blank form field means "no barcode": '' → null, so forms don't need special handling. */
const optionalBarcode = z.union([z.literal('').transform(() => null), barcodeSchema]).nullable();

const productFields = {
  sku: skuSchema,
  barcode: optionalBarcode,
  name: z.string().trim().min(2).max(120),
  categoryId: objectIdSchema,
  price: z.number().int('Price must be in minor units').min(1).max(LIMITS.maxMoney),
  unit: z.enum(UNITS),
  reorderLevel: z.number().int().min(0).max(LIMITS.maxDocQty),
};

export const createProductSchema = z
  .object(productFields)
  .partial({ barcode: true, unit: true, reorderLevel: true });

export const updateProductSchema = z
  .object({ ...productFields, isActive: z.boolean() })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'Nothing to update');

export const productListQuery = z.object({
  categoryId: objectIdSchema.optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
  q: z.string().trim().max(60).optional(),
  cursor: z.string().max(200).optional(),
});

export const searchQuery = z.object({ q: z.string().trim().min(1).max(60) });

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ProductListQuery = z.infer<typeof productListQuery>;
