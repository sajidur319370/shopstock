import type { RequestHandler } from 'express';
import type { Role } from '@shopstock/shared';
import { User } from '../db/models';
import { forbidden, unauthenticated } from '../lib/errors';
import { allBranchIds, getSettings } from '../lib/cache';
import { makeCtx } from '../types/ctx';

export const loadActor =
  (opts: { allowPasswordChange?: boolean } = {}): RequestHandler =>
  async (req, _res, next) => {
    // NEVER cached: deactivation and reassignment take effect on the next request (FR-AUTH-15).
    const user = await User.findById(req.userId)
      .select('email name role branchIds isActive mustChangePassword')
      .lean();
    if (!user || !user.isActive) throw unauthenticated('ACCOUNT_DISABLED', 'Your account is disabled.');
    if (user.mustChangePassword && !opts.allowPasswordChange) {
      throw forbidden('PASSWORD_CHANGE_REQUIRED', 'Please change your password first.');
    }

    const role = user.role as Role;
    req.ctx = makeCtx({
      userId: user._id,
      userName: user.name,
      email: user.email,
      role,
      branchIds: role === 'owner' ? await allBranchIds() : user.branchIds,
      settings: await getSettings(),
    });
    next();
  };
