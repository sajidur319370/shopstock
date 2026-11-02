import { Types } from 'mongoose';
import {
  REASON_SIGN,
  type AdjustmentInput,
  type AdjustmentResultDto,
  type StockCountInput,
} from '@shopstock/shared';
import { Inventory, Product } from '../../db/models';
import { counterKeys, nextSeq } from '../../db/counters';
import { withTransaction } from '../../db/transaction';
import { badRequest, conflict } from '../../lib/errors';
import { oid, pad6 } from '../../lib/ids';
import { isDuplicateKey } from '../../lib/mongoErrors';
import type { BranchCtx } from '../../types/ctx';
import { withStockChanges } from './stock';

/** All requested products, archived included (you can write off an archived product). */
export async function loadProducts(ids: string[]) {
  const rows = await Product.find({ _id: { $in: ids.map(oid) } })
    .select('sku name reorderLevel isActive')
    .lean();
  if (rows.length !== new Set(ids).size) throw badRequest('INVALID_PRODUCT', 'Unknown product.');
  return new Map(rows.map((p) => [String(p._id), p]));
}

/** Opening stock, damage, loss, found… One numbered batch, all lines or none (queries.md §9.1). */
export async function createAdjustment(ctx: BranchCtx, input: AdjustmentInput): Promise<AdjustmentResultDto> {
  // Reason ↔ sign (count_correction allows both)
  const sign = REASON_SIGN[input.reason];
  if (sign !== 0 && input.lines.some((l) => Math.sign(l.qtyChange) !== sign)) {
    throw badRequest(
      'INVALID_REASON',
      `"${input.reason}" lines must be ${sign > 0 ? 'positive' : 'negative'}.`,
    );
  }
  if (input.reason === 'opening_balance' && input.lines.some((l) => l.unitCost === undefined)) {
    throw badRequest('UNIT_COST_REQUIRED', 'Opening stock needs a unit cost.');
  }
  const products = await loadProducts(input.lines.map((l) => l.productId));

  return withTransaction(async (session) => {
    // Inside the transaction: a failed batch rolls its number back too (gapless per branch).
    const seq = await nextSeq(counterKeys.adjustment(ctx.branchId), session);
    const refNo = `${ctx.branchCode}-ADJ-${pad6(seq)}`;
    const refId = new Types.ObjectId();

    await withStockChanges(
      ctx,
      session,
      { refType: 'adjustment', refId, refNo, reason: input.reason, note: input.note },
      async (stock) => {
        for (const l of input.lines) {
          const productId = oid(l.productId);
          const product = products.get(l.productId)!;
          if (l.qtyChange > 0) {
            await stock.in({
              branchId: ctx.branchId,
              productId,
              qty: l.qtyChange,
              unitCost: l.unitCost,
              type: 'adjustment',
              reorderDefault: product.reorderLevel,
            });
          } else {
            await stock.out({
              branchId: ctx.branchId,
              productId,
              qty: -l.qtyChange,
              type: 'adjustment',
              name: product.name,
            });
          }
        }
      },
    );
    return { refNo, refId: String(refId), lines: input.lines.length };
  }, 'adjustment');
}

/**
 * "I counted 18 when the screen said 20" is only valid if it STILL says 20 (queries.md §9.2).
 * The update filter includes the quantity that was shown (compare-and-set).
 */
export async function submitStockCount(ctx: BranchCtx, input: StockCountInput): Promise<AdjustmentResultDto> {
  // Friendly pre-check: report EVERY changed line at once (the CAS below is the real guarantee).
  const rows = await Inventory.find({
    branchId: ctx.branchId,
    productId: { $in: input.lines.map((l) => oid(l.productId)) },
  })
    .select('productId quantity')
    .lean();
  const current = new Map(rows.map((r) => [String(r.productId), r.quantity]));
  const changed = input.lines
    .filter((l) => (current.get(l.productId) ?? 0) !== l.expectedQty)
    .map((l) => ({
      productId: l.productId,
      expected: l.expectedQty,
      current: current.get(l.productId) ?? 0,
    }));
  if (changed.length) throw conflict('STOCK_CHANGED', 'Stock changed while you were counting.', changed);

  const diffs = input.lines.filter((l) => l.countedQty !== l.expectedQty);
  if (!diffs.length) return { refNo: null, refId: null, lines: 0 };
  await loadProducts(diffs.map((l) => l.productId));

  try {
    return await withTransaction(async (session) => {
      const seq = await nextSeq(counterKeys.adjustment(ctx.branchId), session);
      const refNo = `${ctx.branchCode}-ADJ-${pad6(seq)}`;
      const refId = new Types.ObjectId();
      const ref = {
        refType: 'adjustment',
        refId,
        refNo,
        reason: 'count_correction',
        note: input.note,
      } as const;
      await withStockChanges(ctx, session, ref, async (stock) => {
        for (const l of diffs) {
          const delta = l.countedQty - l.expectedQty;
          const args = {
            branchId: ctx.branchId,
            productId: oid(l.productId),
            type: 'adjustment' as const,
            expectQuantity: l.expectedQty,
          };
          if (delta > 0)
            await stock.in({ ...args, qty: delta, unitCost: l.unitCost }); // cost only if no row yet
          else await stock.out({ ...args, qty: -delta });
        }
      });
      return { refNo, refId: String(refId), lines: diffs.length };
    }, 'stock-count');
  } catch (err) {
    // Counting up from 0 while someone created the row: the upsert hit the unique index.
    if (isDuplicateKey(err, 'uniq_inventory_row')) {
      throw conflict('STOCK_CHANGED', 'Stock changed while you were counting.');
    }
    throw err;
  }
}
