import { Schema, model } from 'mongoose';
import { BPS, RECEIPT_FORMATS } from '@shopstock/shared';
import { int } from '../fields';

const bps = (max: number, def: number) => ({ type: Number, min: 0, max, default: def, validate: int });

const settingsSchema = new Schema(
  {
    _id: { type: String, default: 'shop' },
    shopName: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    currency: {
      code: { type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/, immutable: true },
      symbol: { type: String, required: true, maxlength: 4, immutable: true },
      minorUnits: { type: Number, required: true, min: 0, max: 3, validate: int, immutable: true },
    },
    timezone: { type: String, required: true },
    taxRateBps: bps(5_000, 0),
    taxLabel: { type: String, trim: true, maxlength: 12, default: 'VAT' },
    discountCapsBps: {
      cashier: bps(BPS, 1_000), // 10%
      manager: bps(BPS, 3_000), // 30%
    },
    returnWindowDays: { type: Number, min: 0, max: 365, default: 30, validate: int },
    invoiceFooter: { type: String, maxlength: 300, default: 'Thank you for shopping with us!' },
    receiptFormat: { type: String, enum: RECEIPT_FORMATS, default: '80mm' },
    setupAt: { type: Date, required: true },
  },
  { collection: 'settings', timestamps: true, versionKey: false },
);

export const Settings = model('Settings', settingsSchema);
