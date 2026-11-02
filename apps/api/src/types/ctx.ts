import type { Types } from 'mongoose';
import { ROLE_LEVEL, type Role } from '@shopstock/shared';
import type { ShopSettings } from '../lib/cache';

export interface Ctx {
  userId: Types.ObjectId;
  userName: string;
  role: Role;
  roleLevel: number;
  branchIds: Types.ObjectId[]; // branches this actor may access (Owner: all)
  settings: ShopSettings; // cached shop settings (tz, tax, caps, currency)
  now: () => Date; // injectable clock: tests and the seed control time
}

/** Set by resolveBranch on /b/:branchCode routes. */
export interface BranchCtx extends Ctx {
  branchId: Types.ObjectId;
  branchCode: string;
}

export function makeCtx(p: Omit<Ctx, 'roleLevel' | 'now'> & { now?: () => Date }): Ctx {
  return { ...p, roleLevel: ROLE_LEVEL[p.role], now: p.now ?? (() => new Date()) };
}

export const canAccess = (ctx: Ctx, branchId: Types.ObjectId) =>
  ctx.branchIds.some((b) => b.equals(branchId));

/** Owner unlimited; others from settings. */
export const discountCapFor = (ctx: Pick<Ctx, 'role' | 'settings'>) =>
  ctx.role === 'owner' ? 10_000 : ctx.settings.discountCapsBps[ctx.role];
