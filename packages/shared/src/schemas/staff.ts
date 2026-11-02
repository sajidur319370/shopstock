import { z } from 'zod';
import { LIMITS, STAFF_ROLES } from '../constants';
import { emailSchema, objectIdSchema, passwordSchema, personNameSchema } from './common';

const branchIdsSchema = z
  .array(objectIdSchema)
  .min(1)
  .max(LIMITS.branchesPerManager)
  .refine((a) => new Set(a).size === a.length, 'Duplicate branches');

export const createStaffSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  role: z.enum(STAFF_ROLES),
  branchIds: branchIdsSchema,
  temporaryPassword: passwordSchema,
});

export const updateStaffSchema = z
  .object({
    name: personNameSchema,
    role: z.enum(STAFF_ROLES),
    branchIds: branchIdsSchema,
    isActive: z.boolean(),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, 'Nothing to update');

export const resetStaffPasswordSchema = z.object({ temporaryPassword: passwordSchema });

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
