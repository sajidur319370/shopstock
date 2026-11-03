import type { Types } from 'mongoose';
import { daysBetween, LIMITS, type ReportBranchDto } from '@shopstock/shared';
import { listBranches } from '../../lib/cache';
import { badRequest, notFound } from '../../lib/errors';
import { oid } from '../../lib/ids';
import { canAccess, type Ctx } from '../../types/ctx';

/** A period of 1–366 days, from ≤ to (its own error code: not a generic VALIDATION_ERROR). */
export function assertPeriod(f: { from: string; to: string }) {
  if (f.from > f.to || daysBetween(f.from, f.to) + 1 > LIMITS.reportMaxDays) {
    throw badRequest('INVALID_DATE_RANGE', `Choose a period of 1 to ${LIMITS.reportMaxDays} days.`);
  }
}

/** FR-SCOPE-05: a subset of MY branches (default: all of them). Any other id → the usual 404. */
export function assertReportBranches(ctx: Ctx, ids: (string | Types.ObjectId)[]): Types.ObjectId[] {
  if (ids.length === 0) return ctx.branchIds;
  const out = ids.map(oid);
  if (!out.every((id) => canAccess(ctx, id))) throw notFound();
  return out;
}

/** Codes and names for the selected branches, in code order: the UI labels series without another request. */
export async function reportBranches(ids: Types.ObjectId[]): Promise<ReportBranchDto[]> {
  const wanted = new Set(ids.map(String));
  return (await listBranches())
    .filter((b) => wanted.has(String(b._id)))
    .map((b) => ({ branchId: String(b._id), code: b.code, name: b.name }));
}
