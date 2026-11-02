import { Types } from 'mongoose';
import { makeCtx, type BranchCtx } from '../../src/types/ctx';
import { getSettings } from '../../src/lib/cache';

export const SYSTEM_USER = new Types.ObjectId('000000000000000000000001');

/** An Owner context for one branch, for calling services directly (bypassing HTTP). */
export async function ownerCtxFor(
  branchId: Types.ObjectId,
  code: string,
  now?: () => Date,
): Promise<BranchCtx> {
  const base = makeCtx({
    userId: SYSTEM_USER,
    userName: 'System',
    role: 'owner',
    branchIds: [branchId],
    settings: await getSettings(),
    now,
  });
  return { ...base, branchId, branchCode: code };
}
