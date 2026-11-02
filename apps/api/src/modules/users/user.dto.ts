import type { Types } from 'mongoose';
import type { Role, UserDto } from '@shopstock/shared';

type UserLike = {
  _id: Types.ObjectId;
  email: string;
  name: string;
  role: string;
  mustChangePassword?: boolean | null;
};

export const toUserDto = (u: UserLike): UserDto => ({
  id: String(u._id),
  email: u.email,
  name: u.name,
  role: u.role as Role,
  mustChangePassword: !!u.mustChangePassword,
});
