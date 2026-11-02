import type { Types } from 'mongoose';
import {
  LIMITS,
  type CreateStaffInput,
  type Role,
  type StaffRole,
  type UpdateStaffInput,
} from '@shopstock/shared';
import { Session, User } from '../../db/models';
import { withTransaction } from '../../db/transaction';
import { listBranches } from '../../lib/cache';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { oid } from '../../lib/ids';
import { pick } from '../../lib/objects';
import { hashPassword } from '../../lib/password';
import { canAccess, type Ctx } from '../../types/ctx';
import { toStaffDto } from './staff.dto';

const STAFF_FIELDS = 'email name role branchIds isActive mustChangePassword lastLoginAt createdAt';

/** Owner: everyone. Manager: users sharing at least one of my branches (multikey index). */
export async function listStaff(ctx: Ctx) {
  const filter = ctx.role === 'owner' ? {} : { branchIds: { $in: ctx.branchIds } };
  const users = await User.find(filter).select(STAFF_FIELDS).sort({ role: 1, name: 1 }).lean();
  return users.map(toStaffDto);
}

/** Role ceiling (FR-USR-02/04). Throws unless the actor may manage a user with this role and these branches. */
export function assertCanManage(
  ctx: Ctx,
  target: { role: Role | string; branchIds: Types.ObjectId[]; _id?: Types.ObjectId },
) {
  if (target._id?.equals(ctx.userId)) throw forbidden('FORBIDDEN', "You can't change your own access.");
  if (target.role === 'owner') throw forbidden('FORBIDDEN', 'The owner account cannot be changed here.');
  if (ctx.role === 'owner') return;
  // Manager: cashiers only, and only within my branches.
  if (ctx.role !== 'manager' || target.role !== 'cashier') throw forbidden();
  if (!target.branchIds.every((b) => canAccess(ctx, b))) throw forbidden();
}

/** cashier: exactly 1 branch; manager: 1–10; every branch exists. */
async function assertBranchShape(target: { role: StaffRole; branchIds: Types.ObjectId[] }) {
  if (target.role === 'cashier' && target.branchIds.length !== 1) {
    throw badRequest('INVALID_BRANCHES', 'A cashier works at exactly one branch.');
  }
  const known = new Set((await listBranches()).map((b) => String(b._id)));
  if (!target.branchIds.every((b) => known.has(String(b))))
    throw badRequest('INVALID_BRANCHES', 'Unknown branch.');
}

/** A user the actor may see at all: managers only see staff of their branches (others → 404). */
async function loadVisible(ctx: Ctx, userId: Types.ObjectId) {
  const target = await User.findById(userId).select('role branchIds').lean();
  if (!target) throw notFound();
  if (ctx.role !== 'owner' && !target.branchIds.some((b) => canAccess(ctx, b))) throw notFound();
  return target;
}

export async function createStaff(ctx: Ctx, input: CreateStaffInput) {
  const target = { role: input.role, branchIds: input.branchIds.map(oid) };
  assertCanManage(ctx, target);
  await assertBranchShape(target);
  if ((await User.countDocuments()) >= LIMITS.staff)
    throw conflict('STAFF_LIMIT', 'Maximum number of staff reached.');

  const user = await User.create({
    name: input.name,
    email: input.email,
    ...target,
    passwordHash: await hashPassword(input.temporaryPassword),
    mustChangePassword: true,
    createdBy: ctx.userId,
  }); // E11000 uniq_email → 409 EMAIL_TAKEN
  return toStaffDto(user.toObject());
}

export async function updateStaff(ctx: Ctx, userId: Types.ObjectId, input: UpdateStaffInput) {
  const current = await loadVisible(ctx, userId);
  assertCanManage(ctx, { ...current, _id: userId }); // may I touch them as they are now?
  const next = {
    role: (input.role ?? current.role) as StaffRole,
    branchIds: (input.branchIds ?? current.branchIds).map(oid),
  };
  assertCanManage(ctx, { ...next, _id: userId }); // …and as they would become?
  await assertBranchShape(next);

  const $set = {
    ...pick(input, ['name', 'role', 'isActive']),
    ...(input.branchIds && { branchIds: next.branchIds }),
  };
  await withTransaction(async (session) => {
    // CAS on the role we checked, so a concurrent promotion can't slip past the ceiling.
    const res = await User.updateOne(
      { _id: userId, role: current.role },
      { $set },
      { session, runValidators: true },
    );
    if (res.matchedCount === 0) throw conflict('RETRY', 'This user changed. Reload and try again.');
    if (input.isActive === false) {
      await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: ctx.now() } }, { session });
    }
  }, 'update-staff');

  const updated = await User.findById(userId).select(STAFF_FIELDS).lean();
  return toStaffDto(updated!);
}

export async function resetStaffPassword(ctx: Ctx, userId: Types.ObjectId, temporaryPassword: string) {
  const target = await loadVisible(ctx, userId);
  assertCanManage(ctx, { ...target, _id: userId });
  const passwordHash = await hashPassword(temporaryPassword); // slow: outside the transaction
  await withTransaction(async (session) => {
    await User.updateOne({ _id: userId }, { $set: { passwordHash, mustChangePassword: true } }, { session });
    await Session.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: ctx.now() } }, { session });
  }, 'reset-staff-password');
}
