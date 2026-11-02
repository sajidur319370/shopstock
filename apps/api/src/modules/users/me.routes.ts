import { Router } from 'express';
import {
  changePasswordSchema,
  updateMeSchema,
  type MeResponse,
  type PublicSettingsDto,
} from '@shopstock/shared';
import { Branch, Settings, User } from '../../db/models';
import { notFound } from '../../lib/errors';
import { validate, valid } from '../../middleware/validate';
import { changePassword } from '../auth/auth.service';
import { toUserDto } from './user.dto';

export const meRouter = Router(); // mounted behind `authenticate`

// Setup and schema defaults always fill the nested paths; Mongoose's types can't prove it (Day 5 moves this to lib/cache).
type StoredSettings = Omit<PublicSettingsDto, 'discountCapBps'> & {
  discountCapsBps: { cashier: number; manager: number };
};

meRouter.get('/', async (req, res) => {
  const user = await User.findById(req.userId).lean();
  if (!user) throw notFound();
  const doc = await Settings.findById('shop').lean();
  if (!doc) throw notFound();
  const settings = doc as unknown as StoredSettings;
  const branches = await Branch.find(user.role === 'owner' ? {} : { _id: { $in: user.branchIds } })
    .select('code name isActive')
    .sort({ code: 1 })
    .lean();
  const body: MeResponse = {
    user: toUserDto(user),
    branches: branches.map((b) => ({ id: String(b._id), code: b.code, name: b.name, isActive: b.isActive })),
    settings: {
      shopName: settings.shopName,
      currency: settings.currency,
      timezone: settings.timezone,
      taxRateBps: settings.taxRateBps,
      taxLabel: settings.taxLabel,
      discountCapBps:
        user.role === 'owner' ? 10_000 : settings.discountCapsBps[user.role as 'manager' | 'cashier'],
      returnWindowDays: settings.returnWindowDays,
      receiptFormat: settings.receiptFormat,
      invoiceFooter: settings.invoiceFooter,
    },
  };
  res.json(body);
});

const updateReq = { body: updateMeSchema };
meRouter.patch('/', validate(updateReq), async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.userId,
    { $set: valid(req, updateReq).body },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!user) throw notFound();
  res.json({ user: toUserDto(user) });
});

const pwReq = { body: changePasswordSchema };
meRouter.patch('/password', validate(pwReq), async (req, res) => {
  const { currentPassword, newPassword } = valid(req, pwReq).body;
  await changePassword(req.userId, req.sessionId, currentPassword, newPassword);
  res.json({ ok: true });
});
