import { z } from 'zod';
import { LIMITS, PO_STATUSES } from '../constants';
import { dateOnlySchema, emailSchema, moneySchema, objectIdSchema, uuidSchema } from './common';

/*
 * Field shapes WITHOUT defaults: Zod 4 applies `.default()` even under `.partial()`, so an update
 * schema built from defaulted fields would blank every field a PATCH leaves out. Defaults live on
 * the create schemas only.
 */
const supplierFields = {
  name: z.string().trim().min(2).max(80),
  contactName: z.string().trim().max(60),
  phone: z.string().trim().max(30),
  email: emailSchema.or(z.literal('')),
  address: z.string().trim().max(200),
  notes: z.string().max(1000),
};

export const supplierSchema = z.object({
  name: supplierFields.name,
  contactName: supplierFields.contactName.default(''),
  phone: supplierFields.phone.default(''),
  email: supplierFields.email.default(''),
  address: supplierFields.address.default(''),
  notes: supplierFields.notes.default(''),
});
export const updateSupplierSchema = z
  .object({ ...supplierFields, isActive: z.boolean() })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'Nothing to update');

export const supplierListQuery = z.object({
  q: z.string().trim().max(60).optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
  cursor: z.string().max(200).optional(),
});

const poLines = z
  .array(
    z.object({
      productId: objectIdSchema,
      orderedQty: z.number().int().min(1).max(LIMITS.maxDocQty),
      unitCost: moneySchema,
    }),
  )
  .min(1)
  .max(LIMITS.poLines)
  .refine((a) => new Set(a.map((l) => l.productId)).size === a.length, 'Each product once');

/** `expectedDate ≥ today` depends on the shop timezone: the service checks it, not Zod. */
export const createPOSchema = z.object({
  supplierId: objectIdSchema,
  lines: poLines,
  expectedDate: dateOnlySchema.nullish(),
  notes: z.string().max(1000).default(''),
});
export const updatePOSchema = z
  .object({
    supplierId: objectIdSchema,
    lines: poLines,
    expectedDate: dateOnlySchema.nullable(), // null clears it
    notes: z.string().max(1000),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'Nothing to update');

export const receivePOSchema = z.object({
  clientReceiptId: uuidSchema, // idempotency key: the same delivery twice = applied once
  lines: z
    .array(
      z.object({
        productId: objectIdSchema,
        qty: z.number().int().min(1).max(LIMITS.maxDocQty),
        unitCost: moneySchema.optional(), // override: the invoice price differs from the PO (Should)
      }),
    )
    .min(1)
    .max(LIMITS.poLines)
    .refine((a) => new Set(a.map((l) => l.productId)).size === a.length, 'Each product once'),
  note: z.string().max(500).default(''),
});

export const poListQuery = z.object({
  status: z.enum(PO_STATUSES).optional(),
  supplierId: objectIdSchema.optional(),
  cursor: z.string().max(300).optional(),
});

export type SupplierInput = z.infer<typeof supplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type SupplierListQuery = z.infer<typeof supplierListQuery>;
export type CreatePOInput = z.infer<typeof createPOSchema>;
export type UpdatePOInput = z.infer<typeof updatePOSchema>;
export type ReceivePOInput = z.infer<typeof receivePOSchema>;
export type POListQuery = z.infer<typeof poListQuery>;
