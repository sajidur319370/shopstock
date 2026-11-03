import type { Types } from 'mongoose';
import type { Role } from '@shopstock/shared';
import { getSettings } from '../../src/lib/cache';
import { makeCtx, type BranchCtx, type Ctx } from '../../src/types/ctx';

export type SeedUser = { _id: Types.ObjectId; name: string; role: Role; branchIds: Types.ObjectId[] };
export type SeedBranch = { _id: Types.ObjectId; code: string };

/** A context exactly like loadActor builds, but with the seed's clock. */
export async function ctxFor(user: SeedUser, now: () => Date, allBranchIds: Types.ObjectId[]): Promise<Ctx> {
  return makeCtx({
    userId: user._id,
    userName: user.name,
    role: user.role,
    branchIds: user.role === 'owner' ? allBranchIds : user.branchIds,
    settings: await getSettings(),
    now,
  });
}

/** …plus the branch resolveBranch would set (the user must have access: the services trust ctx). */
export async function branchCtxFor(
  user: SeedUser,
  branch: SeedBranch,
  now: () => Date,
  allBranchIds: Types.ObjectId[],
): Promise<BranchCtx> {
  const ctx = await ctxFor(user, now, allBranchIds);
  if (!ctx.branchIds.some((b) => b.equals(branch._id)))
    throw new Error(`${user.name} can't act at ${branch.code}`);
  return { ...ctx, branchId: branch._id, branchCode: branch.code };
}
