import { Schema, model } from 'mongoose';
import { BARCODE, LIMITS, SKU, UNITS } from '@shopstock/shared';
import { int, money } from '../fields';

const productSchema = new Schema(
  {
    sku: { type: String, required: true, uppercase: true, trim: true, match: SKU },
    barcode: { type: String, trim: true, match: BARCODE, default: null },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    nameLower: { type: String, required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    price: { ...money(), min: 1 },
    unit: { type: String, enum: UNITS, default: 'pcs' },
    reorderLevel: { type: Number, min: 0, max: LIMITS.maxDocQty, default: 0, validate: int },
    isActive: { type: Boolean, default: true },
    priceUpdatedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { collection: 'products', timestamps: true, versionKey: false },
);

// Runs on create()/save() only, NOT on findOneAndUpdate: the service sets nameLower itself on rename.
productSchema.pre('validate', function () {
  if (this.name) this.nameLower = this.name.toLowerCase();
});

productSchema.index({ sku: 1 }, { unique: true, name: 'uniq_sku' });
// Partial: only real strings must be unique, so any number of products can have barcode: null.
productSchema.index(
  { barcode: 1 },
  { unique: true, partialFilterExpression: { barcode: { $type: 'string' } }, name: 'uniq_barcode' },
);
productSchema.index({ isActive: 1, nameLower: 1 }); // POS prefix search (AP4) + list
productSchema.index({ categoryId: 1, nameLower: 1 }); // list by category
productSchema.index({ name: 'text' }, { name: 'product_text' }); // word search (fallback)

export const Product = model('Product', productSchema);
