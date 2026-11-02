import type { MovementQuery } from '@shopstock/shared';
import { Product, StockMovement, User } from '../../db/models';
import { decodeCursor, encodeCursor, olderThan } from '../../lib/cursor';
import { oid } from '../../lib/ids';
import type { BranchCtx } from '../../types/ctx';
import { toMovementDto } from './inventory.dto';

const PAGE = 30;

/** Newest first, (createdAt, _id) cursor (queries.md §16). Names hydrated with one $in query each: no N+1. */
export async function listMovements(ctx: BranchCtx, f: MovementQuery, limit = PAGE) {
  const filter: Record<string, unknown> = { branchId: ctx.branchId };
  if (f.productId) filter.productId = oid(f.productId);
  if (f.type) filter.type = f.type;
  if (f.from || f.to) filter.businessDate = { ...(f.from && { $gte: f.from }), ...(f.to && { $lte: f.to }) };
  if (f.cursor) Object.assign(filter, olderThan(decodeCursor(f.cursor)));

  const rows = await StockMovement.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();
  const page = rows.slice(0, limit);
  const unique = <T>(xs: T[]) => [...new Set(xs.map(String))].map(oid);

  const [users, products] = await Promise.all([
    User.find({ _id: { $in: unique(page.map((m) => m.userId)) } })
      .select('name')
      .lean(),
    f.productId
      ? Promise.resolve([])
      : Product.find({ _id: { $in: unique(page.map((m) => m.productId)) } })
          .select('name')
          .lean(),
  ]);
  const names = {
    users: new Map(users.map((u) => [String(u._id), u.name])),
    products: new Map(products.map((p) => [String(p._id), p.name])),
  };
  const last = page.at(-1);
  return {
    items: page.map((m) => toMovementDto(m, ctx, names)), // cost only with inventory:viewCost
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
}
