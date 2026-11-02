/**
 * THE STOCK MODULE: the only code in the codebase that changes inventory.quantity (ESLint enforces it).
 * One door in (stockIn), one door out (stockOut); each writes an immutable movement in the SAME
 * transaction, so the audit trail can't drift from the stock it describes (queries.md §6).
 */
import { Types, type ClientSession } from 'mongoose';
import { toBusinessDate, type AdjustmentReason, type MovementType, type RefType } from '@shopstock/shared';
import { Inventory, StockMovement } from '../../db/models';
import { badRequest, conflict } from '../../lib/errors';
import { oid } from '../../lib/ids';
import type { BranchCtx, Ctx } from '../../types/ctx';

export interface StockRef {
  refType: RefType;
  refId: Types.ObjectId;
  refNo: string;
  reason?: AdjustmentReason | null;
  note?: string;
}

interface OutArgs {
  branchId: Types.ObjectId;
  productId: Types.ObjectId;
  qty: number;
  type: MovementType;
  name?: string; // for the INSUFFICIENT_STOCK message
  expectQuantity?: number; // stock count: compare-and-set on the exact quantity seen
}

interface InArgs {
  branchId: Types.ObjectId;
  productId: Types.ObjectId;
  qty: number;
  type: MovementType;
  unitCost?: number; // omitted = keep the current average (the row must exist)
  expectQuantity?: number;
  reorderDefault?: number; // new rows copy the product's default reorder level
}

export interface StockOps {
  /** Conditional decrement. Throws 409 INSUFFICIENT_STOCK. Returns the cost per unit (for COGS). */
  out(a: OutArgs): Promise<{ quantityAfter: number; unitCost: number }>;
  /** Stock in with weighted-average cost. */
  in(a: InArgs): Promise<{ quantityAfter: number; avgCostAfter: number }>;
}

type MovementDraft = {
  _id: Types.ObjectId;
  branchId: Types.ObjectId;
  productId: Types.ObjectId;
  type: MovementType;
  qtyChange: number;
  quantityAfter: number;
  unitCost: number;
  valueChange: number;
  refType: RefType;
  refId: Types.ObjectId;
  refNo: string;
  reason: AdjustmentReason | null;
  note: string;
  userId: Types.ObjectId;
  businessDate: string;
  createdAt: Date;
};

/**
 * Runs fn with stock operations bound to this transaction, then inserts all their movements in one
 * insertMany. The movements array is created PER CALL, so a transaction retry starts clean.
 */
export async function withStockChanges<T>(
  ctx: Ctx,
  session: ClientSession,
  ref: StockRef,
  fn: (stock: StockOps) => Promise<T>,
): Promise<T> {
  const movements: MovementDraft[] = [];
  const result = await fn({
    out: (a) => stockOut(ctx, session, ref, a, movements),
    in: (a) => stockIn(ctx, session, ref, a, movements),
  });
  if (movements.length) await StockMovement.insertMany(movements, { session });
  return result;
}

async function stockOut(
  ctx: Ctx,
  session: ClientSession,
  ref: StockRef,
  a: OutArgs,
  movements: MovementDraft[],
) {
  const now = ctx.now();
  const inv = await Inventory.findOneAndUpdate(
    {
      branchId: a.branchId,
      productId: a.productId,
      // The check and the write are ONE atomic operation: no lost update is possible.
      quantity: a.expectQuantity ?? { $gte: a.qty },
    },
    { $inc: { quantity: -a.qty }, $set: { lastMovementAt: now } },
    { session, returnDocument: 'after', projection: { quantity: 1, avgCost: 1 } },
  ).lean();

  if (!inv) {
    const cur = await Inventory.findOne({ branchId: a.branchId, productId: a.productId })
      .select('quantity')
      .session(session)
      .lean();
    if (a.expectQuantity !== undefined) {
      throw conflict('STOCK_CHANGED', 'Stock changed since you counted.', [
        { productId: String(a.productId), current: cur?.quantity ?? 0 },
      ]);
    }
    // A missing row (never stocked here) lands here too: available 0.
    throw conflict('INSUFFICIENT_STOCK', 'Not enough stock.', [
      { productId: String(a.productId), name: a.name, requested: a.qty, available: cur?.quantity ?? 0 },
    ]);
  }

  // quantityAfter and avgCost come from the SAME atomic update: exact even under concurrency (FR-MOV-03).
  movements.push(
    movement(ctx, ref, {
      branchId: a.branchId,
      productId: a.productId,
      type: a.type,
      qtyChange: -a.qty,
      quantityAfter: inv.quantity,
      unitCost: inv.avgCost,
      at: now,
    }),
  );
  return { quantityAfter: inv.quantity, unitCost: inv.avgCost };
}

async function stockIn(
  ctx: Ctx,
  session: ClientSession,
  ref: StockRef,
  a: InArgs,
  movements: MovementDraft[],
) {
  const now = ctx.now();
  if (a.unitCost === undefined) {
    const exists = await Inventory.exists({ branchId: a.branchId, productId: a.productId }).session(session);
    if (!exists)
      throw badRequest('UNIT_COST_REQUIRED', 'Enter a unit cost for a product with no stock here.');
  }

  const oldQ = { $ifNull: ['$quantity', 0] };
  const oldAvg = { $ifNull: ['$avgCost', 0] };
  const cost = a.unitCost ?? '$avgCost'; // a literal number, or "keep the current average"
  const newQ = { $add: [oldQ, a.qty] };

  const inv = await Inventory.findOneAndUpdate(
    {
      branchId: a.branchId,
      productId: a.productId,
      ...(a.expectQuantity !== undefined && { quantity: a.expectQuantity }), // stock count CAS
    },
    [
      {
        // Inside ONE $set stage every expression sees the OLD document, so avgCost uses the old quantity.
        // Never split this into two stages.
        $set: {
          avgCost: {
            $round: [
              { $divide: [{ $add: [{ $multiply: [oldQ, oldAvg] }, { $multiply: [a.qty, cost] }] }, newQ] },
              0,
            ],
          },
          quantity: newQ,
          reorderLevel: { $ifNull: ['$reorderLevel', a.reorderDefault ?? 0] },
          lastMovementAt: now,
          // Update pipelines skip Mongoose timestamps and defaults: set them by hand.
          createdAt: { $ifNull: ['$createdAt', now] },
          updatedAt: now,
        },
      },
    ],
    {
      session,
      upsert: a.expectQuantity === undefined || a.expectQuantity === 0, // the first stock-in creates the row
      returnDocument: 'after',
      projection: { quantity: 1, avgCost: 1 },
      updatePipeline: true, // Mongoose 9: pipelines must be opted into per query
    },
  ).lean();

  if (!inv) {
    // Only possible with expectQuantity (no upsert): the CAS failed.
    const cur = await Inventory.findOne({ branchId: a.branchId, productId: a.productId })
      .select('quantity')
      .session(session)
      .lean();
    throw conflict('STOCK_CHANGED', 'Stock changed since you counted.', [
      { productId: String(a.productId), current: cur?.quantity ?? 0 },
    ]);
  }

  movements.push(
    movement(ctx, ref, {
      branchId: a.branchId,
      productId: a.productId,
      type: a.type,
      qtyChange: a.qty,
      quantityAfter: inv.quantity,
      unitCost: a.unitCost ?? inv.avgCost,
      at: now,
    }),
  );
  return { quantityAfter: inv.quantity, avgCostAfter: inv.avgCost };
}

function movement(
  ctx: Ctx,
  ref: StockRef,
  m: {
    branchId: Types.ObjectId;
    productId: Types.ObjectId;
    type: MovementType;
    qtyChange: number;
    quantityAfter: number;
    unitCost: number;
    at: Date;
  },
): MovementDraft {
  return {
    _id: new Types.ObjectId(),
    branchId: m.branchId,
    productId: m.productId,
    type: m.type,
    qtyChange: m.qtyChange,
    quantityAfter: m.quantityAfter,
    unitCost: m.unitCost,
    valueChange: m.qtyChange * m.unitCost,
    refType: ref.refType,
    refId: ref.refId,
    refNo: ref.refNo,
    reason: ref.reason ?? null,
    note: ref.note ?? '',
    userId: ctx.userId,
    businessDate: toBusinessDate(m.at, ctx.settings.timezone),
    createdAt: m.at, // taken AFTER the atomic update: movements sort in the order the changes happened
  };
}

/**
 * Friendly pre-check (queries.md §11.2): report EVERY short line at once. NOT the guarantee:
 * stock can change right after this read; the conditional decrement in stockOut is what's atomic.
 */
export async function assertStockAvailable(
  ctx: BranchCtx,
  lines: { productId: string; qty: number; name: string }[],
) {
  const rows = await Inventory.find({
    branchId: ctx.branchId,
    productId: { $in: lines.map((l) => oid(l.productId)) },
  })
    .select('productId quantity')
    .lean();
  const onHand = new Map(rows.map((r) => [String(r.productId), r.quantity]));
  const short = lines
    .filter((l) => (onHand.get(l.productId) ?? 0) < l.qty)
    .map((l) => ({
      productId: l.productId,
      name: l.name,
      requested: l.qty,
      available: onHand.get(l.productId) ?? 0,
    }));
  if (short.length)
    throw conflict('INSUFFICIENT_STOCK', `Not enough stock for ${short.length} item(s).`, short);
}
