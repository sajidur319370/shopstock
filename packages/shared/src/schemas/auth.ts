import { z } from 'zod';
import { DEMO_ACCOUNTS } from '../constants';
import { emailSchema, passwordSchema, personNameSchema } from './common';

export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1, 'Required').max(72) });
export const updateMeSchema = z.object({ name: personNameSchema });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: passwordSchema,
});

/** POST /auth/demo: an account name, never a password (the server only allows seeded demo accounts). */
export const demoLoginSchema = z.object({ account: z.enum(DEMO_ACCOUNTS) });

export type LoginInput = z.infer<typeof loginSchema>;
