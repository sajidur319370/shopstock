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

/**
 * 10 FAILED logins per 15 min per IP. Successful ones don't count: a shop's registers share one public
 * IP, and the 11th cashier starting a shift must not be locked out (found by the Day 20 load test).
 */
export const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
});
export const setupLimiter = rateLimit({ ...base, windowMs: 60 * 60_000, limit: 5 });

/**
 * NFR-SEC-07: 600 requests / minute per USER (not per IP: a shop's registers share one public IP).
 * Generous for a busy POS, a wall for scripts. Mounted after loadActor, so req.ctx is set.
 */
export const makeApiLimiter = (limit = 600) =>
  rateLimit({
    ...base,
    windowMs: 60_000,
    limit,
    keyGenerator: (req) => String((req as { ctx?: { userId?: unknown } }).ctx?.userId),
  });
export const apiLimiter = makeApiLimiter();
