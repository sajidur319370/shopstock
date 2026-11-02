import { Schema, model } from 'mongoose';
import { LIMITS } from '@shopstock/shared';
import { branchGuard } from '../plugins/branchGuard';
import { int } from '../fields';

/** Stock of ONE product at ONE branch. Only modules/inventory/stock.ts may change `quantity`. */
const inventorySchema = new Schema(
  {
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, immutable: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, immutable: true },
    quantity: { type: Number, required: true, min: 0, validate: int },
    avgCost: { type: Number, required: true, min: 0, validate: int },
    reorderLevel: { type: Number, min: 0, max: LIMITS.maxDocQty, default: 0, validate: int },
    lastMovementAt: { type: Date, default: null },
  },
  { collection: 'inventory', timestamps: true, versionKey: false },
);

inventorySchema.index({ branchId: 1, productId: 1 }, { unique: true, name: 'uniq_inventory_row' });
inventorySchema.index({ productId: 1, branchId: 1 }); // stock of one product across branches (AP22)

inventorySchema.plugin(branchGuard);
export const Inventory = model('Inventory', inventorySchema);
