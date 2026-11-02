import type { Types } from 'mongoose';
import type { Role, StaffDto } from '@shopstock/shared';

type StaffLike = {
  _id: Types.ObjectId;
  email: string;
  name: string;
  role: string;
  branchIds: Types.ObjectId[];
  isActive: boolean;
  mustChangePassword?: boolean | null;
  lastLoginAt?: Date | null;
};

export const toStaffDto = (u: StaffLike): StaffDto => ({
  id: String(u._id),
  email: u.email,
  name: u.name,
  role: u.role as Role,
  branchIds: u.branchIds.map(String),
  isActive: u.isActive,
  mustChangePassword: !!u.mustChangePassword,
  lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
});
