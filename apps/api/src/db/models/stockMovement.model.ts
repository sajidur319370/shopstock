import { Schema, model } from 'mongoose';
import { ADJUSTMENT_REASONS, MOVEMENT_TYPES, REF_TYPES } from '@shopstock/shared';
import { branchGuard } from '../plugins/branchGuard';
import { dateOnly, int } from '../fields';

/** One change to one inventory row. Immutable: the audit trail is only trustworthy if nothing rewrites it. */
const stockMovementSchema = new Schema(
  {
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    type: { type: String, enum: MOVEMENT_TYPES, required: true },
    qtyChange: {
      type: Number,
      required: true,
      validate: [int, { validator: (v: number) => v !== 0, message: 'qtyChange must not be 0' }],
    },
    quantityAfter: { type: Number, required: true, min: 0, validate: int },
    unitCost: { type: Number, required: true, min: 0, validate: int },
    valueChange: { type: Number, required: true, validate: int }, // qtyChange × unitCost
    refType: { type: String, enum: REF_TYPES, required: true },
    refId: { type: Schema.Types.ObjectId, required: true },
    refNo: { type: String, required: true, maxlength: 40 },
    reason: { type: String, enum: [...ADJUSTMENT_REASONS, null], default: null }, // adjustments only
    note: { type: String, maxlength: 500, default: '' },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    businessDate: dateOnly(),
    createdAt: { type: Date, required: true }, // set explicitly from ctx.now() (tests and the seed control time)
  },
  { collection: 'stockMovements', versionKey: false },
);

stockMovementSchema.index({ branchId: 1, productId: 1, createdAt: -1, _id: -1 }); // product history, reconcile
stockMovementSchema.index({ branchId: 1, createdAt: -1, _id: -1 }); // branch feed
stockMovementSchema.index({ branchId: 1, type: 1, businessDate: 1 }); // shrinkage report (AP20)
stockMovementSchema.index({ branchId: 1, refType: 1, refId: 1 }); // document trail (AP15)

// Append-only (invariant I9): block every update and delete path. Registered BEFORE the branch guard,
// so even a correctly scoped updateOne fails with this clearer message.
const blocked = () => {
  throw new Error('stockMovements are append-only');
};
stockMovementSchema.pre(
  ['updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteMany', 'findOneAndDelete'],
  blocked,
);
stockMovementSchema.pre(['updateOne', 'deleteOne'], { document: false, query: true }, blocked);

stockMovementSchema.plugin(branchGuard);
export const StockMovement = model('StockMovement', stockMovementSchema);
