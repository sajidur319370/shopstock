/**
 * Stock transfers (queries.md §15). Two transactions, not one: dispatch at the source, receive at the
 * destination, each starting with a status compare-and-set. Units are always in exactly one place:
 * the source shelf, the truck (an `in_transit` transfer), or the destination shelf (BR-08).
 * The cost travels with the goods: out at the source's average, in at THAT cost.
 */
import type { Types } from 'mongoose';
import {
  LIMITS,
  toBusinessDate,
  type CreateTransferInput,
  type InTransitDto,
  type Page,
  type TransferDto,
  type TransferListQuery,
  type TransferRowDto,
} from '@shopstock/shared';
import { Transfer, User } from '../../db/models';
import { counterKeys, nextSeq } from '../../db/counters';
import { withTransaction } from '../../db/transaction';
import { getBranchByCode, listBranches } from '../../lib/cache';
import { decodeCursor, encodeCursor, olderThan } from '../../lib/cursor';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { isDefined } from '../../lib/ids';
import { notFoundOrInvalidState } from '../../lib/states';
import type { BranchCtx, Ctx } from '../../types/ctx';
import { loadActiveProducts, reorderDefaults } from '../catalog/loadProducts';
import { assertStockAvailable, withStockChanges } from '../inventory/stock';
import { toTransferDto, toTransferRowDto } from './transfer.dto';

/** Either side may read it; a transfer between two OTHER branches is the same 404 as a missing one. */
const eitherSide = (ctx: BranchCtx) => ({
  $or: [{ fromBranchId: ctx.branchId }, { toBranchId: ctx.branchId }],
});

/** Names for the timeline, one $in query (no N+1). */
async function userNames(ids: (Types.ObjectId | null | undefined)[]): Promise<Map<string, string>> {
  const users = await User.find({ _id: { $in: ids.filter(isDefined) } })
    .select('name')
    .lean();
  return new Map(users.map((u) => [String(u._id), u.name]));
}

async function detail(ctx: BranchCtx, id: Types.ObjectId): Promise<TransferDto> {
  const t = await Transfer.findOne({ _id: id, ...eitherSide(ctx) }).lean();
  if (!t) throw notFound('Transfer not found.');
  return toTransferDto(t, ctx, await userNames([t.createdBy, t.dispatchedBy, t.receivedBy, t.cancelledBy]));
}
export const getTransfer = detail;

/** FR-TRF-01: a manager may send to ANY active branch, including one they don't manage. */
export const destinations = async (ctx: BranchCtx) =>
  (await listBranches())
    .filter((b) => b.isActive && !b._id.equals(ctx.branchId))
    .map((b) => ({ code: b.code, name: b.name })); // codes and names only, nothing else about them

/* ---------- §15.1 create (this branch is the source) ---------- */

export async function createTransfer(ctx: BranchCtx, input: CreateTransferInput): Promise<TransferDto> {
  const to = await getBranchByCode(input.toBranchCode);
  if (!to || !to.isActive) throw badRequest('INVALID_BRANCH', 'Choose an active destination branch.');
  if (to._id.equals(ctx.branchId)) throw badRequest('SAME_BRANCH', 'Source and destination must differ.');
  const products = await loadActiveProducts(input.lines.map((l) => l.productId)); // PRODUCT_INACTIVE / DUPLICATE_LINE

  const year = Number(toBusinessDate(ctx.now(), ctx.settings.timezone).slice(0, 4));
  const seq = await nextSeq(counterKeys.transfer(year)); // outside a transaction: gaps OK
  const t = await Transfer.create({
    transferNo: `TR-${year}-${String(seq).padStart(4, '0')}`,
    fromBranchId: ctx.branchId,
    toBranchId: to._id,
    fromCode: ctx.branchCode,
    toCode: to.code,
    status: 'pending',
    items: input.lines.map((l) => {
      const p = products.get(l.productId)!;
      return { productId: p._id, sku: p.sku, name: p.name, qty: l.qty, unitCost: null };
    }),
    note: input.note,
    createdBy: ctx.userId,
  });
  return toTransferDto(t.toObject(), ctx, new Map([[String(ctx.userId), ctx.userName]]));
}

/* ---------- §15.2 dispatch (at the source) ---------- */

export async function dispatchTransfer(ctx: BranchCtx, id: Types.ObjectId): Promise<TransferDto> {
  const t = await Transfer.findOne({ _id: id, fromBranchId: ctx.branchId }).lean();
  if (!t) throw notFound('Transfer not found.'); // not mine as the source
  if (t.status !== 'pending')
    throw conflict('INVALID_STATE', `This transfer is ${String(t.status).replace('_', ' ')}.`);
  // Goods shouldn't leave for a branch that closed after the transfer was created.
  const to = await getBranchByCode(t.toCode);
  if (!to?.isActive) throw badRequest('INVALID_BRANCH', `${t.toCode} is no longer active.`);
  // Friendly pre-check: EVERY short line at once (the UI marks them). NOT the guarantee.
  await assertStockAvailable(
    ctx,
    t.items.map((i) => ({ productId: String(i.productId), qty: i.qty, name: i.name })),
  );

  await withTransaction(async (session) => {
    const now = ctx.now();
    // 1. The state CAS FIRST: a parallel dispatch or cancel makes it match nothing, so no stock moves.
    const claimed = await Transfer.updateOne(
      { _id: id, fromBranchId: ctx.branchId, status: 'pending' },
      { $set: { status: 'in_transit', dispatchedBy: ctx.userId, dispatchedAt: now } },
      { session },
    );
    if (claimed.modifiedCount === 0) throw conflict('INVALID_STATE', 'This transfer is no longer pending.');

    // 2. Stock out at the source (conditional decrement: the guarantee). Each returns its average cost.
    const costs = await withStockChanges(
      ctx,
      session,
      { refType: 'transfer', refId: t._id, refNo: t.transferNo },
      async (stock) => {
        const out: number[] = [];
        for (const line of t.items) {
          const { unitCost } = await stock.out({
            branchId: ctx.branchId,
            productId: line.productId,
            qty: line.qty,
            type: 'transfer_out',
            name: line.name,
          });
          out.push(unitCost);
        }
        return out;
      },
    );

    // 3. The cost each line LEFT with, in line order: the destination receives at exactly this cost.
    await Transfer.updateOne(
      { _id: id, fromBranchId: ctx.branchId },
      { $set: Object.fromEntries(costs.map((c, i) => [`items.${i}.unitCost`, c])) },
      { session },
    );
  }, 'transfer-dispatch');
  return detail(ctx, id);
}

/* ---------- §15.3 receive (at the destination) ---------- */

export async function receiveTransfer(ctx: BranchCtx, id: Types.ObjectId): Promise<TransferDto> {
  await withTransaction(async (session) => {
    const now = ctx.now();
    // The state CAS is the first write, and it pins toBranchId: the SOURCE can't receive (AC-TRF-03).
    const t = await Transfer.findOneAndUpdate(
      { _id: id, toBranchId: ctx.branchId, status: 'in_transit' },
      { $set: { status: 'received', receivedBy: ctx.userId, receivedAt: now } },
      { session, returnDocument: 'after' },
    ).lean();
    if (!t) {
      const exists = await Transfer.exists({ _id: id, toBranchId: ctx.branchId }).session(session);
      throw exists
        ? conflict('INVALID_STATE', 'This transfer is not in transit.')
        : notFound('Transfer not found.');
    }
    const reorderLevels = await reorderDefaults(t.items.map((i) => i.productId));
    await withStockChanges(
      ctx,
      session,
      { refType: 'transfer', refId: t._id, refNo: t.transferNo },
      async (stock) => {
        for (const line of t.items) {
          await stock.in({
            branchId: ctx.branchId,
            productId: line.productId,
            qty: line.qty,
            unitCost: line.unitCost!, // set at dispatch: in_transit implies it
            type: 'transfer_in',
            reorderDefault: reorderLevels.get(String(line.productId)),
          });
        }
      },
    );
  }, 'transfer-receive');
  return detail(ctx, id);
}

/* ---------- §15.4 cancel and list ---------- */

/** Source only, pending only: nothing has left yet, so nothing moves back. */
export async function cancelTransfer(ctx: BranchCtx, id: Types.ObjectId): Promise<TransferDto> {
  const t = await Transfer.findOneAndUpdate(
    { _id: id, fromBranchId: ctx.branchId, status: 'pending' },
    { $set: { status: 'cancelled', cancelledBy: ctx.userId, cancelledAt: ctx.now() } },
    { returnDocument: 'after' },
  ).lean();
  if (!t) throw await notFoundOrInvalidState(Transfer, { _id: id, fromBranchId: ctx.branchId });
  return toTransferDto(t, ctx, await userNames([t.createdBy, t.cancelledBy]));
}

/**
 * Newest first. The direction can be an $or and the cursor is an $or too: two `$or` keys can't share
 * one object (one would silently overwrite the other, scope included), so they're combined with $and.
 */
export async function listTransfers(ctx: BranchCtx, f: TransferListQuery): Promise<Page<TransferRowDto>> {
  const scope =
    f.direction === 'incoming'
      ? { toBranchId: ctx.branchId }
      : f.direction === 'outgoing'
        ? { fromBranchId: ctx.branchId }
        : eitherSide(ctx);
  const filter = {
    $and: [
      scope,
      ...(f.status ? [{ status: f.status }] : []),
      ...(f.cursor ? [olderThan(decodeCursor(f.cursor))] : []),
    ],
  };
  const limit = LIMITS.pageSize;
  const rows = await Transfer.find(filter)
    .select('transferNo fromBranchId fromCode toCode status items.qty dispatchedAt receivedAt createdAt')
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((t) => toTransferRowDto(t, ctx)),
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
}

/* ---------- §15.5 units in transit for a product (Should, FR-TRF-07) ---------- */

/** Either end at one of MY branches. Grouped per (from, to) pair: "In transit: 20 GUL → DHN". */
export async function inTransitFor(ctx: Ctx, productId: Types.ObjectId): Promise<InTransitDto[]> {
  const groups = await Transfer.aggregate<{ _id: { from: string; to: string }; qty: number }>([
    {
      $match: {
        $or: [{ fromBranchId: { $in: ctx.branchIds } }, { toBranchId: { $in: ctx.branchIds } }],
        status: 'in_transit',
      },
    },
    { $unwind: '$items' },
    { $match: { 'items.productId': productId } },
    { $group: { _id: { from: '$fromCode', to: '$toCode' }, qty: { $sum: '$items.qty' } } },
    { $sort: { '_id.from': 1, '_id.to': 1 } },
  ]);
  return groups.map((g) => ({ from: g._id.from, to: g._id.to, qty: g.qty }));
}
