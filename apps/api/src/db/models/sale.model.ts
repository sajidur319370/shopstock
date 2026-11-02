import { Schema, model } from 'mongoose';
import { DISCOUNT_TYPES, LIMITS, PAYMENT_METHODS, SALE_RETURN_STATUSES } from '@shopstock/shared';
import { branchGuard } from '../plugins/branchGuard';
import { dateOnly, int, money } from '../fields';

const discountSchema = new Schema(
  {
    type: { type: String, enum: DISCOUNT_TYPES, required: true },
    bps: { type: Number, min: 0, max: 10_000, validate: int, default: null }, // percent
    amount: { type: Number, min: 0, validate: int, default: null }, // amount
  },
  { _id: false },
);

/** Price AND cost are snapshots: reports never look up today's price or cost (data-model.md D1). */
const saleLineSchema = new Schema(
  {
    // _id kept: it's the saleLineId that returns point to
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    sku: { type: String, required: true },
    name: { type: String, required: true },
    qty: { type: Number, required: true, min: 1, max: LIMITS.maxLineQty, validate: int },
    unitPrice: money(),
    unitCost: money(), // avgCost at the moment of sale
    discount: { type: discountSchema, default: null }, // the line discount INPUT
    lineDiscount: money(), // computed amount
    cartShare: money(), // share of the cart discount
    net: money(),
    tax: money(),
    total: money(),
    returnedQty: { type: Number, min: 0, default: 0, validate: int },
  },
  { _id: true },
);

const paymentSchema = new Schema(
  {
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    amount: { ...money(), min: 1 },
    reference: { type: String, trim: true, maxlength: 60, default: '' },
  },
  { _id: false },
);

const saleSchema = new Schema(
  {
    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', required: true, immutable: true },
    branchCode: { type: String, required: true, immutable: true },
    invoiceNo: { type: String, required: true, immutable: true }, // 'GUL-000124'
    seq: { type: Number, required: true, immutable: true },
    clientSaleId: { type: String, required: true, immutable: true }, // idempotency key (UUID)
    cashierId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    cashierName: { type: String, required: true },
    items: {
      type: [saleLineSchema],
      validate: {
        validator: (a: unknown[]) => a.length >= 1 && a.length <= LIMITS.saleLines,
        message: '1–100 lines',
      },
    },
    discount: { type: discountSchema, default: null }, // the cart discount INPUT
    taxRateBps: { type: Number, required: true, min: 0, validate: int },
    totals: {
      subtotal: money(),
      discount: money(),
      net: money(),
      tax: money(),
      total: money(),
      cost: money(), // Σ unitCost × qty
      itemCount: { type: Number, required: true, min: 1, validate: int },
    },
    payments: {
      type: [paymentSchema],
      validate: {
        validator: (a: unknown[]) => a.length >= 1 && a.length <= LIMITS.payments,
        message: '1–3 payments',
      },
    },
    change: money(),
    customer: {
      name: { type: String, trim: true, maxlength: 60, default: '' },
      phone: { type: String, trim: true, maxlength: 20, default: '' },
    },
    note: { type: String, maxlength: 200, default: '' },
    returnStatus: { type: String, enum: SALE_RETURN_STATUSES, default: 'none' },
    printCount: { type: Number, default: 0, min: 0, validate: int },
    businessDate: dateOnly(),
    createdAt: { type: Date, required: true, immutable: true }, // set from ctx.now()
  },
  { collection: 'sales', versionKey: false },
);

saleSchema.index({ invoiceNo: 1 }, { unique: true, name: 'uniq_invoice_no' });
saleSchema.index({ branchId: 1, clientSaleId: 1 }, { unique: true, name: 'uniq_client_sale' }); // idempotency
saleSchema.index({ branchId: 1, createdAt: -1, _id: -1 }); // history (AP9)
saleSchema.index({ branchId: 1, cashierId: 1, createdAt: -1 }); // my sales (AP10)
saleSchema.index({ branchId: 1, businessDate: 1 }); // dashboard, reports (AP19, AP20)

saleSchema.plugin(branchGuard);
export const Sale = model('Sale', saleSchema);
