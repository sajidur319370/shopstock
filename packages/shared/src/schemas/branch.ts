import { z } from 'zod';
import { branchFieldsSchema } from './setup';

export const createBranchSchema = branchFieldsSchema;
export const updateBranchSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    address: z.string().trim().max(200),
    phone: z.string().trim().max(30),
    isActive: z.boolean(),
  })
  .partial() // no `code`: immutable (invoice numbers use it)
  .refine((o) => Object.keys(o).length > 0, 'Nothing to update');

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
