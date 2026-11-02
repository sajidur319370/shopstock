import { Router, type NextFunction, type Request, type Response } from 'express';
import { setupSchema } from '@shopstock/shared';
import { env } from '../../config/env';
import { forbidden } from '../../lib/errors';
import { safeEqual } from '../../lib/crypto';
import { validate, valid } from '../../middleware/validate';
import { setupLimiter } from '../../middleware/rateLimits';
import { startSession } from '../auth/auth.service';
import { setRefreshCookie } from '../auth/cookies';
import { toUserDto } from '../users/user.dto';
import * as svc from './setup.service';

const meta = (req: Request) => ({ userAgent: req.get('user-agent') ?? '', ip: req.ip ?? '' });

export const setupRouter = Router();

setupRouter.get('/status', async (_req, res) => {
  res.json({ needsSetup: await svc.needsSetup(), tokenRequired: Boolean(env.SETUP_TOKEN) });
});

/** Read per request (not at import), so tests can switch it on and off. */
function requireSetupToken(req: Request, _res: Response, next: NextFunction) {
  if (env.SETUP_TOKEN && !safeEqual(req.get('x-setup-token') ?? '', env.SETUP_TOKEN))
    throw forbidden('SETUP_TOKEN_REQUIRED', 'A valid setup token is required.');
  next();
}

const setupReq = { body: setupSchema };
setupRouter.post('/', setupLimiter, requireSetupToken, validate(setupReq), async (req, res) => {
  const { owner } = await svc.setup(valid(req, setupReq).body);
  const { accessToken, refreshToken } = await startSession(owner._id, meta(req)); // the Owner is logged in right away
  setRefreshCookie(res, refreshToken);
  res.status(201).json({ user: toUserDto(owner), accessToken });
});
