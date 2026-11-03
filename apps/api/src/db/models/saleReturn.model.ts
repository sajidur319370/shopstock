import { Schema, model } from 'mongoose';
import { LIMITS, PAYMENT_METHODS, RETURN_REASONS } from '@shopstock/shared';
import { branchGuard } from '../plugins/branchGuard';
import { dateOnly, int, money } from '../fields';

/** Snapshots of the sale line plus THIS return's share of it (schema.md §14). */
const returnLineSchema = new Schema(
  {
    saleLineId: { type: Schema.Types.ObjectId, required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    qty: { type: Number, required: true, min: 1, validate: int },
    unitPrice: money(),
    unitCost: money(),
    net: money(),
    tax: money(),
    total: money(),
    restock: { type: Boolean, required: true },
    writeOffCost: money(), // unitCost × qty when restock = false, else 0
  },
  { _id: false },
);

/** Named SaleReturn (collection `returns`) so the identifier never reads like the `return` keyword. */
const saleReturnSchema = new Schema(
  {
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, immutable: true },
    returnNo: { type: String, required: true, immutable: true }, // 'GUL-R-000012'
    clientReturnId: { type: String, required: true, immutable: true }, // idempotency key (UUID)
    saleId: { type: Schema.Types.ObjectId, ref: 'Sale', required: true },
    invoiceNo: { type: String, required: true },
    items: {
      type: [returnLineSchema],
      validate: {
        validator: (a: unknown[]) => a.length >= 1 && a.length <= LIMITS.returnLines,
        message: '1–100 lines',
      },
    },
    totals: {
      net: money(),
      tax: money(),
      total: money(),
      costRestocked: money(), // Σ unitCost × qty where restock (D2)
      writeOff: money(), // Σ writeOffCost
      itemCount: { type: Number, required: true, min: 1, validate: int },
    },
    refund: {
      method: { type: String, enum: PAYMENT_METHODS, required: true },
      amount: money(),
    },
    reason: { type: String, enum: RETURN_REASONS, required: true },
    note: { type: String, maxlength: 500, default: '' },
    processedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    processedByName: { type: String, required: true },
    businessDate: dateOnly(), // the RETURN's day: it reduces that day's net sales, not the sale's
    createdAt: { type: Date, required: true, immutable: true },
  },
  { collection: 'returns', versionKey: false },
);

saleReturnSchema.index({ returnNo: 1 }, { unique: true, name: 'uniq_return_no' });
saleReturnSchema.index({ branchId: 1, clientReturnId: 1 }, { unique: true, name: 'uniq_client_return' });
saleReturnSchema.index({ branchId: 1, saleId: 1 }); // the sale page's "returns" list
saleReturnSchema.index({ branchId: 1, businessDate: 1 }); // reports (Day 19)
saleReturnSchema.index({ branchId: 1, createdAt: -1, _id: -1 }); // the returns list

saleReturnSchema.plugin(branchGuard);
export const SaleReturn = model('SaleReturn', saleReturnSchema);
