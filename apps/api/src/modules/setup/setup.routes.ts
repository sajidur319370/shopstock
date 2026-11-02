import { Router, type Request } from 'express';
import { setupSchema } from '@shopstock/shared';
import { validate, valid } from '../../middleware/validate';
import { setupLimiter } from '../../middleware/rateLimits';
import { startSession } from '../auth/auth.service';
import { setRefreshCookie } from '../auth/cookies';
import { toUserDto } from '../users/user.dto';
import * as svc from './setup.service';

const meta = (req: Request) => ({ userAgent: req.get('user-agent') ?? '', ip: req.ip ?? '' });

export const setupRouter = Router();

setupRouter.get('/status', async (_req, res) => {
  res.json({ needsSetup: await svc.needsSetup() });
});

const setupReq = { body: setupSchema };
setupRouter.post('/', setupLimiter, validate(setupReq), async (req, res) => {
  const { owner } = await svc.setup(valid(req, setupReq).body);
  const { accessToken, refreshToken } = await startSession(owner._id, meta(req)); // the Owner is logged in right away
  setRefreshCookie(res, refreshToken);
  res.status(201).json({ user: toUserDto(owner), accessToken });
});
