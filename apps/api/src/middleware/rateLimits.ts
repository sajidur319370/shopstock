import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { AppError } from '../lib/errors';

const handler = (_req: unknown, _res: unknown, next: (e: unknown) => void) =>
  next(new AppError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.'));
const base = {
  standardHeaders: 'draft-8' as const,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  handler,
};

export const loginLimiter = rateLimit({ ...base, windowMs: 15 * 60_000, limit: 10 });
export const setupLimiter = rateLimit({ ...base, windowMs: 60 * 60_000, limit: 5 });
