import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email'));

export const passwordSchema = z
  .string()
  .min(8, 'At least 8 characters')
  .max(72, 'At most 72 characters') // bcrypt ignores bytes after 72
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one digit');

export const personNameSchema = z.string().trim().min(1, 'Required').max(60);

export const timezoneSchema = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown timezone');

export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
export const uuidSchema = z.uuid('Invalid id');
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const moneySchema = z.number().int('Use whole minor units').min(0).max(1_000_000_000);
export const bpsSchema = z.number().int().min(0).max(10_000);
