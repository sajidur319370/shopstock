import { Router, type Request } from 'express';
import { demoLoginSchema, loginSchema } from '@shopstock/shared';
import { validate, valid } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { demoGuard } from '../../middleware/demoGuard';
import { demoLoginLimiter, loginLimiter } from '../../middleware/rateLimits';
import * as auth from './auth.service';
import { REFRESH_COOKIE, clearRefreshCookie, setRefreshCookie } from './cookies';

const meta = (req: Request): auth.ClientMeta => ({
  userAgent: req.get('user-agent') ?? '',
  ip: req.ip ?? '',
});
const cookie = (req: Request): string | undefined => req.cookies?.[REFRESH_COOKIE];

export const authRouter = Router();

const loginReq = { body: loginSchema };
authRouter.post('/login', loginLimiter, validate(loginReq), async (req, res) => {
  const { user, accessToken, refreshToken } = await auth.login(valid(req, loginReq).body, meta(req));
  setRefreshCookie(res, refreshToken);
  res.json({ user, accessToken });
});

const demoReq = { body: demoLoginSchema };
authRouter.post('/demo', demoLoginLimiter, validate(demoReq), async (req, res) => {
  const { account } = valid(req, demoReq).body;
  const { user, accessToken, refreshToken } = await auth.demoLogin(account, meta(req));
  setRefreshCookie(res, refreshToken);
  res.json({ user, accessToken });
});

authRouter.post('/refresh', async (req, res) => {
  try {
    const { accessToken, refreshToken } = await auth.refresh(cookie(req), meta(req));
    setRefreshCookie(res, refreshToken);
    res.json({ accessToken });
  } catch (err) {
    clearRefreshCookie(res);
    throw err;
  }
});

authRouter.post('/logout', async (req, res) => {
  await auth.logout(cookie(req));
  clearRefreshCookie(res);
  res.status(204).end();
});

authRouter.post('/logout-all', authenticate, demoGuard, async (req, res) => {
  await auth.revokeAllSessions(req.userId);
  clearRefreshCookie(res);
  res.status(204).end();
});
