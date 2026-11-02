import { Router } from 'express';
import { updateSettingsSchema } from '@shopstock/shared';
import { Settings } from '../../db/models';
import { getSettings, invalidateCache } from '../../lib/cache';
import { flattenForSet } from '../../lib/objects';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import { toPublicSettings } from './settings.dto';

export const settingsRouter = Router();

settingsRouter.get('/', authorize('settings:view'), async (req, res) => {
  res.json({ settings: toPublicSettings(req.ctx) }); // the same shape as /me.settings
});

/** Owner-only: the full stored settings, including both discount caps (the settings page needs them). */
settingsRouter.get('/full', authorize('settings:update'), async (_req, res) => {
  res.json({ settings: await getSettings() });
});

const updateReq = { body: updateSettingsSchema };
settingsRouter.patch('/', authorize('settings:update'), validate(updateReq), async (req, res) => {
  // { 'discountCapsBps.cashier': 500 } so a partial nested object doesn't wipe its siblings
  const $set = flattenForSet(valid(req, updateReq).body);
  await Settings.updateOne({ _id: 'shop' }, { $set }, { runValidators: true });
  invalidateCache();
  const settings = await getSettings();
  res.json({ settings: toPublicSettings({ ...req.ctx, settings }), full: settings });
});
