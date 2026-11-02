import type { PublicSettingsDto } from '@shopstock/shared';
import { discountCapFor, type Ctx } from '../../types/ctx';

/** What every signed-in user may see. `discountCapBps` is the CURRENT actor's cap. */
export const toPublicSettings = (ctx: Pick<Ctx, 'role' | 'settings'>): PublicSettingsDto => ({
  shopName: ctx.settings.shopName,
  currency: ctx.settings.currency,
  timezone: ctx.settings.timezone,
  taxRateBps: ctx.settings.taxRateBps,
  taxLabel: ctx.settings.taxLabel,
  discountCapBps: discountCapFor(ctx),
  returnWindowDays: ctx.settings.returnWindowDays,
  receiptFormat: ctx.settings.receiptFormat,
  invoiceFooter: ctx.settings.invoiceFooter,
});
