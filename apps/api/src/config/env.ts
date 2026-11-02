import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  MONGODB_URI: z.string().min(1),
  APP_URL: z.url().default('http://localhost:5173'),
  DEBUG_MONGO: z.string().optional(),
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().default(900), // 15 min; set 30 in dev to test refresh
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  // Optional: 'debug' shows "transaction retried" lines (write conflicts being resolved). Tests stay silent.
  // Production: when set, POST /setup needs this value in the x-setup-token header, so a fresh public
  // deployment can't be claimed by whoever opens it first. Setup can only succeed once anyway.
  SETUP_TOKEN: z.string().min(16).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:\n' + z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
