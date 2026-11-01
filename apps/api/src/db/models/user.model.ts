import { Schema, model } from 'mongoose';
import { ROLES } from '@shopstock/shared';

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 60 },
    role: { type: String, enum: ROLES, required: true },
    branchIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Branch' }], default: [] }, // [] for owner = all
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { collection: 'users', timestamps: true, versionKey: false },
);

userSchema.index({ email: 1 }, { unique: true, name: 'uniq_email' });
userSchema.index(
  { role: 1 },
  { unique: true, partialFilterExpression: { role: 'owner' }, name: 'one_owner' },
);
userSchema.index({ branchIds: 1, role: 1 }); // staff of a branch (multikey)

export const User = model('User', userSchema);
