import { z } from 'zod';
import { RECEIPT_FORMATS } from '../constants';
import { bpsSchema, timezoneSchema } from './common';

/** Currency is immutable after setup (FR-SET-03), so it isn't here at all. */
export const updateSettingsSchema = z
  .object({
    shopName: z.string().trim().min(2).max(80),
    timezone: timezoneSchema,
    taxRateBps: z.number().int().min(0).max(5_000),
    taxLabel: z.string().trim().min(1).max(12),
    discountCapsBps: z.object({ cashier: bpsSchema, manager: bpsSchema }).partial(),
    returnWindowDays: z.number().int().min(0).max(365),
    invoiceFooter: z.string().max(300),
    receiptFormat: z.enum(RECEIPT_FORMATS),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'Nothing to update');

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
