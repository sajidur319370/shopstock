import { Router } from 'express';
import { changePasswordSchema, updateMeSchema, type MeResponse } from '@shopstock/shared';
import { User } from '../../db/models';
import { listBranches } from '../../lib/cache';
import { notFound } from '../../lib/errors';
import { noPermissionNeeded } from '../../middleware/authorize';
import { demoGuard, demoSetupLock } from '../../middleware/demoGuard';
import { validate, valid } from '../../middleware/validate';
import { canAccess } from '../../types/ctx';
import { changePassword } from '../auth/auth.service';
import { toPublicSettings } from '../settings/settings.dto';
import { toUserDto } from './user.dto';

export const meRouter = Router(); // mounted behind authenticate + loadActor({ allowPasswordChange: true })

meRouter.get('/', noPermissionNeeded('own profile'), async (req, res) => {
  const ctx = req.ctx;
  const user = await User.findById(ctx.userId).select('email name role mustChangePassword').lean();
  if (!user) throw notFound();
  const body: MeResponse = {
    user: toUserDto(user),
    branches: (await listBranches())
      .filter((b) => canAccess(ctx, b._id))
      .map((b) => ({ id: String(b._id), code: b.code, name: b.name, isActive: b.isActive })),
    settings: toPublicSettings(ctx),
  };
  res.json(body);
});

const updateReq = { body: updateMeSchema };
meRouter.patch(
  '/',
  noPermissionNeeded('own profile'),
  demoSetupLock,
  validate(updateReq),
  async (req, res) => {
    const user = await User.findByIdAndUpdate(
      req.ctx.userId,
      { $set: valid(req, updateReq).body },
      { returnDocument: 'after', runValidators: true },
    ).lean();
    if (!user) throw notFound();
    res.json({ user: toUserDto(user) });
  },
);

const pwReq = { body: changePasswordSchema };
meRouter.patch(
  '/password',
  noPermissionNeeded('own password'),
  demoGuard,
  validate(pwReq),
  async (req, res) => {
    const { currentPassword, newPassword } = valid(req, pwReq).body;
    await changePassword(req.ctx.userId, req.sessionId, currentPassword, newPassword);
    res.json({ ok: true });
  },
);
