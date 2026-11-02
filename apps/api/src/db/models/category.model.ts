import { Schema, model } from 'mongoose';

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 40 },
    nameLower: { type: String, required: true },
  },
  { collection: 'categories', timestamps: true, versionKey: false },
);

// Runs on create()/save() only, NOT on updateOne: the service sets nameLower itself on rename.
categorySchema.pre('validate', function () {
  if (this.name) this.nameLower = this.name.toLowerCase();
});

categorySchema.index({ nameLower: 1 }, { unique: true, name: 'uniq_category_name' });

export const Category = model('Category', categorySchema);
