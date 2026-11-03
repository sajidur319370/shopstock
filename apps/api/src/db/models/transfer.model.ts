import { Schema, model } from 'mongoose';
import { LIMITS, TRANSFER_STATUSES } from '@shopstock/shared';
import { branchGuard } from '../plugins/branchGuard';
import { int } from '../fields';

const transferLineSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    qty: { type: Number, required: true, min: 1, max: LIMITS.maxDocQty, validate: int },
    unitCost: { type: Number, min: 0, validate: int, default: null }, // set at dispatch: the cost the units LEFT with
  },
  { _id: false },
);

/**
 * Branch-owned with TWO keys: the guard accepts a filter that pins either one (or an $or / $and of
 * them). State machine: data-model.md §9.2. Units in transit are derived from `in_transit` transfers.
 */
const transferSchema = new Schema(
  {
    transferNo: { type: String, required: true, immutable: true }, // 'TR-2026-0003'
    fromBranchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, immutable: true },
    toBranchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, immutable: true },
    fromCode: { type: String, required: true },
    toCode: { type: String, required: true },
    status: { type: String, enum: TRANSFER_STATUSES, default: 'pending' },
    items: {
      type: [transferLineSchema],
      validate: {
        validator: (a: unknown[]) => a.length >= 1 && a.length <= LIMITS.transferLines,
        message: '1–200 lines',
      },
    },
    note: { type: String, maxlength: 500, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    dispatchedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    dispatchedAt: { type: Date, default: null },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    receivedAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },
  },
  { collection: 'transfers', timestamps: true, versionKey: false },
);

transferSchema.index({ transferNo: 1 }, { unique: true, name: 'uniq_transfer_no' });
transferSchema.index({ fromBranchId: 1, status: 1, createdAt: -1 }); // outgoing (AP18)
transferSchema.index({ toBranchId: 1, status: 1, createdAt: -1 }); // incoming (AP18)
// The list, newest first, without a status filter; the "all" $or merges these two (not in schema.md).
transferSchema.index({ fromBranchId: 1, createdAt: -1, _id: -1 });
transferSchema.index({ toBranchId: 1, createdAt: -1, _id: -1 });

transferSchema.plugin(branchGuard, { keys: ['fromBranchId', 'toBranchId'] });
export const Transfer = model('Transfer', transferSchema);
