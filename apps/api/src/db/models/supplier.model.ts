import { Schema, model } from 'mongoose';

/** Shop-wide. Deactivated, never deleted (POs keep pointing at them). */
const supplierSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    nameLower: { type: String, required: true },
    contactName: { type: String, trim: true, maxlength: 60, default: '' },
    phone: { type: String, trim: true, maxlength: 30, default: '' },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
    address: { type: String, trim: true, maxlength: 200, default: '' },
    notes: { type: String, maxlength: 1000, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { collection: 'suppliers', timestamps: true, versionKey: false },
);

// Runs on create()/save() only, NOT on updates: the service sets nameLower itself on rename.
supplierSchema.pre('validate', function () {
  if (this.name) this.nameLower = this.name.toLowerCase();
});

supplierSchema.index({ nameLower: 1 }, { unique: true, name: 'uniq_supplier_name' });
supplierSchema.index({ isActive: 1, nameLower: 1 });

export const Supplier = model('Supplier', supplierSchema);
