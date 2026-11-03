/**
 * POST /api/b/:code/returns (queries.md §13). The same shape as createSale, run backwards:
 *   bounded     never more than was sold on a line: $elemMatch + positional $inc is ONE atomic check-and-write
 *   exact       refund = portion(before + q) − portion(before): partial returns add up to the line, to the cent
 *   honest      restock = stock in at the ORIGINAL unit cost; write-off = no stock change, loss recorded
 *   gapless     the return number is taken inside the transaction
 *   idempotent  the same clientReturnId → the same return
 */
import { Types } from 'mongoose';
import {
  daysBetween,
  LIMITS,
  refundPart,
  toBusinessDate,
  type CreateReturnInput,
  type Page,
  type PaymentMethod,
  type ReturnDto,
  type ReturnRowDto,
  type ReturnsListQuery,
  type SaleReturnLinkDto,
} from '@shopstock/shared';
import { Sale, SaleReturn } from '../../db/models';
import { counterKeys, nextSeq } from '../../db/counters';
import { withTransaction } from '../../db/transaction';
import { decodeCursor, encodeCursor, olderThan } from '../../lib/cursor';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { oid, pad6 } from '../../lib/ids';
import { isDuplicateKey } from '../../lib/mongoErrors';
import type { BranchCtx } from '../../types/ctx';
import { withStockChanges } from '../inventory/stock';
import { toReturnDto, toReturnRowDto } from './return.dto';

const currentReturned = (
  items: { _id: Types.ObjectId; returnedQty?: number | null }[],
  lineId: Types.ObjectId,
) => items.find((i) => i._id.equals(lineId))?.returnedQty ?? 0;

export async function createReturn(
  ctx: BranchCtx,
  input: CreateReturnInput,
): Promise<{ return: ReturnDto; replayed: boolean }> {
  // 0. Idempotency fast path: a retry of a return that already committed.
  const prior = await SaleReturn.findOne({
    branchId: ctx.branchId,
    clientReturnId: input.clientReturnId,
  }).lean();
  if (prior) return { return: toReturnDto(prior, ctx), replayed: true };

  // 1. The sale, in THIS branch (another branch's sale is a 404, like a missing one).
  const sale = await Sale.findOne({ _id: oid(input.saleId), branchId: ctx.branchId }).lean();
  if (!sale) throw notFound('Sale not found.');

  // 2. The window is in calendar days in the shop's timezone, not in milliseconds.
  const today = toBusinessDate(ctx.now(), ctx.settings.timezone);
  if (daysBetween(sale.businessDate, today) > ctx.settings.returnWindowDays) {
    throw conflict(
      'RETURN_WINDOW_EXPIRED',
      `Returns are accepted within ${ctx.settings.returnWindowDays} days.`,
    );
  }

  // 3. Every line must belong to this sale, once.
  const lineIds = input.lines.map((l) => l.saleLineId);
  if (new Set(lineIds).size !== lineIds.length)
    throw badRequest('DUPLICATE_LINE', 'Each sale line may appear only once.');
  const saleLines = input.lines.map((l) => {
    const line = sale.items.find((i) => String(i._id) === l.saleLineId);
    if (!line)
      throw badRequest('INVALID_LINE', 'That item is not on this sale.', [{ saleLineId: l.saleLineId }]);
    return { input: l, line };
  });
  const refundMethod = (input.refundMethod ?? sale.payments[0]!.method) as PaymentMethod;

  // 4. The transaction. Everything per-attempt is created INSIDE the callback: the driver may re-run it.
  try {
    const doc = await withTransaction(async (session) => {
      const now = ctx.now();
      const seq = await nextSeq(counterKeys.return(ctx.branchId), session); // inside: gapless
      const returnNo = `${ctx.branchCode}-R-${pad6(seq)}`;
      const returnId = new Types.ObjectId();
      let latestItems = sale.items;

      const items = await withStockChanges(
        ctx,
        session,
        { refType: 'return', refId: returnId, refNo: returnNo },
        async (stock) => {
          const out = [];
          for (const { input: l, line } of saleLines) {
            // The guarantee: ONE element is matched AND checked, and `items.$` updates that same element.
            // (Two separate conditions on items._id and items.returnedQty could match different lines.)
            const updated = await Sale.findOneAndUpdate(
              {
                _id: sale._id,
                branchId: ctx.branchId,
                items: { $elemMatch: { _id: line._id, returnedQty: { $lte: line.qty - l.qty } } },
              },
              { $inc: { 'items.$.returnedQty': l.qty } },
              { session, returnDocument: 'after', projection: { items: 1 } },
            ).lean();
            if (!updated) {
              throw conflict(
                'RETURN_EXCEEDS_SOLD',
                `Only ${line.qty - currentReturned(latestItems, line._id)} of "${line.name}" can still be returned.`,
                [{ saleLineId: String(line._id) }],
              );
            }
            latestItems = updated.items;
            // `before` from the SAME write: exact even when another return raced this one.
            const before = currentReturned(updated.items, line._id) - l.qty;

            const net = refundPart(line.net, line.qty, before, l.qty);
            const tax = refundPart(line.tax, line.qty, before, l.qty);
            const total = refundPart(line.total, line.qty, before, l.qty);

            if (l.restock) {
              // Back at the ORIGINAL cost, so the branch average is re-blended correctly.
              await stock.in({
                branchId: ctx.branchId,
                productId: line.productId,
                qty: l.qty,
                unitCost: line.unitCost,
                type: 'return',
              });
            }
            out.push({
              saleLineId: line._id,
              productId: line.productId,
              sku: line.sku,
              name: line.name,
              qty: l.qty,
              unitPrice: line.unitPrice,
              unitCost: line.unitCost,
              net,
              tax,
              total,
              restock: l.restock,
              writeOffCost: l.restock ? 0 : line.unitCost * l.qty, // shrinkage in the profit report
            });
          }
          return out;
        },
      );

      // From the LAST updated document, not the sale loaded before the transaction.
      const full = latestItems.every((i) => (i.returnedQty ?? 0) >= i.qty);
      await Sale.updateOne(
        { _id: sale._id, branchId: ctx.branchId },
        { $set: { returnStatus: full ? 'full' : 'partial' } },
        { session },
      );

      const sum = (k: 'net' | 'tax' | 'total' | 'writeOffCost') => items.reduce((s, i) => s + i[k], 0);
      const [r] = await SaleReturn.create(
        [
          {
            _id: returnId,
            branchId: ctx.branchId,
            returnNo,
            clientReturnId: input.clientReturnId,
            saleId: sale._id,
            invoiceNo: sale.invoiceNo,
            items,
            totals: {
              net: sum('net'),
              tax: sum('tax'),
              total: sum('total'),
              costRestocked: items.filter((i) => i.restock).reduce((s, i) => s + i.unitCost * i.qty, 0),
              writeOff: sum('writeOffCost'),
              itemCount: items.reduce((s, i) => s + i.qty, 0),
            },
            refund: { method: refundMethod, amount: sum('total') },
            reason: input.reason,
            note: input.note,
            processedBy: ctx.userId,
            processedByName: ctx.userName,
            businessDate: toBusinessDate(now, ctx.settings.timezone), // counts on the day it HAPPENS
            createdAt: now,
          },
        ],
        { session }, // E11000 uniq_client_return here → the whole transaction rolls back
      );
      return r!.toObject();
    }, 'return');
    return { return: toReturnDto(doc, ctx), replayed: false };
  } catch (err) {
    // Idempotency race path: the same clientReturnId committed in a parallel request.
    if (isDuplicateKey(err, 'uniq_client_return')) {
      const original = await SaleReturn.findOne({
        branchId: ctx.branchId,
        clientReturnId: input.clientReturnId,
      }).lean();
      if (original) return { return: toReturnDto(original, ctx), replayed: true };
    }
    throw err;
  }
}

/** Newest first, (createdAt, _id) cursor: stable while new returns keep arriving. */
export async function listReturns(ctx: BranchCtx, f: ReturnsListQuery): Promise<Page<ReturnRowDto>> {
  const filter: Record<string, unknown> = { branchId: ctx.branchId };
  if (f.invoiceNo) filter.invoiceNo = f.invoiceNo.toUpperCase();
  if (f.from || f.to) filter.businessDate = { ...(f.from && { $gte: f.from }), ...(f.to && { $lte: f.to }) };
  if (f.cursor) Object.assign(filter, olderThan(decodeCursor(f.cursor)));

  const limit = LIMITS.pageSize;
  const rows = await SaleReturn.find(filter)
    .select('returnNo saleId invoiceNo totals.itemCount refund reason processedByName businessDate createdAt')
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toReturnRowDto),
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
}

/** By id. Another branch's return: the same 404 as a missing one. */
export async function getReturn(ctx: BranchCtx, id: Types.ObjectId): Promise<ReturnDto> {
  const r = await SaleReturn.findOne({ _id: id, branchId: ctx.branchId }).lean();
  if (!r) throw notFound('Return not found.');
  return toReturnDto(r, ctx);
}

/** The returns made against one sale, oldest first: the sale page links them. */
export async function returnsForSale(ctx: BranchCtx, saleId: Types.ObjectId): Promise<SaleReturnLinkDto[]> {
  const rows = await SaleReturn.find({ branchId: ctx.branchId, saleId })
    .select('returnNo totals.total createdAt')
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  return rows.map((r) => ({
    id: String(r._id),
    returnNo: r.returnNo,
    total: r.totals!.total,
    createdAt: r.createdAt.toISOString(),
  }));
}
