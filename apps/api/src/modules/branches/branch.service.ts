import type { Types } from 'mongoose';
import { LIMITS, type CreateBranchInput, type UpdateBranchInput } from '@shopstock/shared';
import { Branch } from '../../db/models';
import { createBranchCounters } from '../../db/counters';
import { withTransaction } from '../../db/transaction';
import { invalidateCache, listBranches } from '../../lib/cache';
import { conflict, notFound } from '../../lib/errors';
import { canAccess, type Ctx } from '../../types/ctx';
import { toBranchDto } from './branch.dto';

/** The branch and its 3 counters in ONE transaction (data-model.md §13). */
export async function createBranch(ctx: Ctx, input: CreateBranchInput) {
  if ((await Branch.countDocuments()) >= LIMITS.branches) {
    throw conflict('BRANCH_LIMIT', 'Maximum number of branches reached.');
  }
  const branch = await withTransaction(async (session) => {
    const [b] = await Branch.create([{ ...input, createdBy: ctx.userId }], { session }); // E11000 → BRANCH_CODE_TAKEN
    await createBranchCounters(b!._id, session);
    return b!;
  }, 'create-branch');
  invalidateCache();
  return toBranchDto(branch);
}

export async function updateBranch(_ctx: Ctx, id: Types.ObjectId, input: UpdateBranchInput) {
  const b = await Branch.findByIdAndUpdate(
    id,
    { $set: input },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!b) throw notFound();
  invalidateCache();
  return toBranchDto(b);
}

/** Branches the actor can see (FR-BR-07). */
export async function listMyBranches(ctx: Ctx) {
  return (await listBranches()).filter((b) => canAccess(ctx, b._id)).map(toBranchDto);
}
