import { z } from 'zod';
import { BRANCH_CODE } from '../constants';
import { emailSchema, passwordSchema, personNameSchema, timezoneSchema } from './common';

export const currencySchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, '3-letter ISO code, e.g. BDT'),
  symbol: z.string().trim().min(1).max(4),
  minorUnits: z.number().int().min(0).max(3),
});

export const branchCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(BRANCH_CODE, '2–8 letters/digits, starting with a letter (e.g. GUL)');

export const branchFieldsSchema = z.object({
  code: branchCodeSchema,
  name: z.string().trim().min(2).max(60),
  address: z.string().trim().max(200).default(''),
  phone: z.string().trim().max(30).default(''),
});

export const setupSchema = z.object({
  shopName: z.string().trim().min(2).max(80),
  currency: currencySchema,
  timezone: timezoneSchema,
  taxRateBps: z.number().int().min(0).max(5_000).default(0),
  owner: z.object({ name: personNameSchema, email: emailSchema, password: passwordSchema }),
  branch: branchFieldsSchema,
});

export type SetupInput = z.infer<typeof setupSchema>;
