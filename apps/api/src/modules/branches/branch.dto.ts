import type { Types } from 'mongoose';
import type { BranchDto } from '@shopstock/shared';

type BranchLike = {
  _id: Types.ObjectId;
  code: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  isActive: boolean;
};

export const toBranchDto = (b: BranchLike): BranchDto => ({
  id: String(b._id),
  code: b.code,
  name: b.name,
  address: b.address ?? '',
  phone: b.phone ?? '',
  isActive: b.isActive,
});
