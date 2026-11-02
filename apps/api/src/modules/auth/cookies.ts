import type { Response } from 'express';
import { isProd } from '../../config/env';

export const REFRESH_COOKIE = 'ss_refresh';

const options = { httpOnly: true, secure: isProd, sameSite: 'lax' as const, path: '/api/auth' };

export const setRefreshCookie = (res: Response, token: string) =>
  res.cookie(REFRESH_COOKIE, token, { ...options, maxAge: 7 * 24 * 60 * 60 * 1000 });
export const clearRefreshCookie = (res: Response) => res.clearCookie(REFRESH_COOKIE, options);
