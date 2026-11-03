import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { User } from '../db/models';
import { forbidden } from '../lib/errors';

/** Every account the seed creates lives under this domain. */
export const DEMO_DOMAIN = '@demo.shopstock.dev';

/**
 * The public demo (DEMO_MODE=1): anyone can log in as a demo account, so the actions that would lock
 * the next visitor out are refused for demo accounts: changing a password, logging everyone out,
 * editing or resetting a demo user. Selling, receiving, transfers stay open: that's the demo.
 * The account checked is the TARGET (`:id` on staff routes), or yourself (`/me/password`, logout-all).
 */
export const demoGuard: RequestHandler = async (req, _res, next) => {
  if (!env.DEMO_MODE) return next();
  const id = (req.params as { id?: string }).id ?? req.userId;
  const user = id ? await User.findById(id).select('email').lean() : null;
  if (user?.email.endsWith(DEMO_DOMAIN)) throw forbidden('DEMO_READ_ONLY', 'Disabled in the public demo.');
  next();
};

/**
 * The public demo's second rule: a demo account can RUN the shop (sell, return, order, receive,
 * transfer, adjust stock, read every report) but can't change its SETUP: settings, branches, staff,
 * the catalog, suppliers, or its own name. Those are shared by every visitor; one bad edit (a renamed
 * shop on every receipt, a deactivated branch, archived products) would spoil the demo for the next.
 * The account checked is the ACTOR. Mount after authorize() on the setup-changing routes.
 */
export const demoSetupLock: RequestHandler = (req, _res, next) => {
  if (env.DEMO_MODE && req.ctx.email?.endsWith(DEMO_DOMAIN)) {
    throw forbidden('DEMO_READ_ONLY', 'Changing the shop setup is disabled in the public demo.');
  }
  next();
};
