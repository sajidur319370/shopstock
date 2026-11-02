import { z } from 'zod';
import { emailSchema, passwordSchema, personNameSchema } from './common';

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, 'Required').max(72) });
export const updateMeSchema = z.object({ name: personNameSchema });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: passwordSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
