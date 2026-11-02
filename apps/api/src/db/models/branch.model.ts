import { Schema, model } from 'mongoose';
import { BRANCH_CODE } from '@shopstock/shared';

const branchSchema = new Schema(
  {
    code: { type: String, required: true, uppercase: true, trim: true, match: BRANCH_CODE, immutable: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
    address: { type: String, trim: true, maxlength: 200, default: '' },
    phone: { type: String, trim: true, maxlength: 30, default: '' },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { collection: 'branches', timestamps: true, versionKey: false },
);

branchSchema.index({ code: 1 }, { unique: true, name: 'uniq_branch_code' });

export const Branch = model('Branch', branchSchema);
