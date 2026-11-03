import { Schema, model } from 'mongoose';
import { LIMITS, PO_STATUSES } from '@shopstock/shared';
import { branchGuard } from '../plugins/branchGuard';
import { int, money } from '../fields';

const poLineSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    orderedQty: { type: Number, required: true, min: 1, max: LIMITS.maxDocQty, validate: int },
    receivedQty: { type: Number, default: 0, min: 0, validate: int },
    unitCost: money(),
  },
  { _id: false }, // a product appears once per PO, so productId identifies the line
);

const receiptLineSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    qty: { type: Number, required: true, min: 1, validate: int },
    unitCost: money(),
  },
  { _id: false },
);

const receiptSchema = new Schema(
  {
    clientReceiptId: { type: String, required: true }, // idempotency key, unique within the PO
    receivedAt: { type: Date, required: true },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receivedByName: { type: String, required: true },
    lines: { type: [receiptLineSchema], default: [] },
    note: { type: String, maxlength: 500, default: '' },
  },
  { _id: true },
);

/** Branch-owned (the destination branch). State machine: data-model.md §9.1. */
const purchaseOrderSchema = new Schema(
  {
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, immutable: true },
    poNumber: { type: String, required: true, immutable: true }, // 'PO-2026-0007'
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String, required: true },
    status: { type: String, enum: PO_STATUSES, default: 'draft' },
    items: {
      type: [poLineSchema],
      validate: {
        validator: (a: unknown[]) => a.length >= 1 && a.length <= LIMITS.poLines,
        message: '1–200 lines',
      },
    },
    receipts: { type: [receiptSchema], default: [] },
    expectedDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, default: null },
    notes: { type: String, maxlength: 1000, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    orderedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
  },
  { collection: 'purchaseOrders', timestamps: true, versionKey: false },
);

purchaseOrderSchema.index({ poNumber: 1 }, { unique: true, name: 'uniq_po_number' });
purchaseOrderSchema.index({ branchId: 1, status: 1, createdAt: -1 }); // AP17
purchaseOrderSchema.index({ branchId: 1, supplierId: 1, createdAt: -1 });
purchaseOrderSchema.index({ branchId: 1, createdAt: -1, _id: -1 }); // the list, newest first (not in schema.md)

purchaseOrderSchema.plugin(branchGuard);
export const PurchaseOrder = model('PurchaseOrder', purchaseOrderSchema);
