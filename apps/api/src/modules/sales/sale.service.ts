/**
 * POST /api/b/:code/sales (queries.md §11). The one function this project is about:
 *   atomic      invoice number + stock decrements + movements + sale: all or nothing
 *   concurrent  the decrement's filter is the guarantee; the pre-check is only for a friendly error
 *   idempotent  the same clientSaleId → the same sale, even when sent five times at once
 *   gapless     the counter $inc is INSIDE the transaction, so a failed sale returns its number
 *   honest      server-side prices, discount caps and payment checks; cost snapshotted per line
 */
import { Types } from 'mongoose';
import {
  can,
  discountViolations,
  LIMITS,
  priceCart,
  settlePayments,
  toBusinessDate,
  type CreateSaleInput,
  type Page,
  type PaymentMethod,
  type SaleDto,
  type SaleRowDto,
  type SalesListQuery,
  type ShiftSummaryDto,
} from '@shopstock/shared';
import { Product, Sale } from '../../db/models';
import { counterKeys, nextSeq } from '../../db/counters';
import { withTransaction } from '../../db/transaction';
import { decodeCursor, encodeCursor, olderThan } from '../../lib/cursor';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { oid, pad6 } from '../../lib/ids';
import { isDuplicateKey } from '../../lib/mongoErrors';
import { discountCapFor, type BranchCtx } from '../../types/ctx';
import { assertStockAvailable, withStockChanges } from '../inventory/stock';
import { returnsForSale } from '../returns/return.service';
import { toSaleDto, toSaleRowDto } from './sale.dto';

export async function createSale(
  ctx: BranchCtx,
  input: CreateSaleInput,
): Promise<{ sale: SaleDto; replayed: boolean }> {
  // 0. Idempotency fast path (AP8): a retry of a sale that already committed.
  const prior = await Sale.findOne({ branchId: ctx.branchId, clientSaleId: input.clientSaleId }).lean();
  if (prior) return { sale: toSaleDto(prior, ctx), replayed: true };

  // 1. Load products: one line per product, all active.
  const ids = input.lines.map((l) => l.productId);
  if (new Set(ids).size !== ids.length)
    throw badRequest('DUPLICATE_LINE', 'Each product may appear only once.');
  const products = await Product.find({ _id: { $in: ids.map(oid) } })
    .select('sku name price isActive')
    .lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const inactive = ids.filter((id) => !byId.get(id)?.isActive);
  if (inactive.length) {
    throw badRequest(
      'PRODUCT_INACTIVE',
      'Some products are not available.',
      inactive.map((productId) => ({ productId })),
    );
  }

  // 2. Price on the SERVER from the DB: the client never sends prices (the schema strips them).
  const cart = priceCart(
    input.lines.map((l) => ({
      productId: l.productId,
      qty: l.qty,
      unitPrice: byId.get(l.productId)!.price,
      discount: l.discount ?? null,
    })),
    input.discount ?? null,
    ctx.settings.taxRateBps,
  );
  const cap = discountCapFor(ctx);
  const violations = discountViolations(cart, cap);
  if (violations.length) {
    throw forbidden('DISCOUNT_LIMIT', `Your discount limit is ${cap / 100}%.`, { capBps: cap, violations });
  }
  // FR-PRC-06: the price changed between the cashier's screen and now → show the new cart, don't charge.
  if (input.expectedTotal !== undefined && input.expectedTotal !== cart.total) {
    throw conflict('PRICE_CHANGED', 'Prices changed. Please review the new total.', { cart });
  }
  const pay = settlePayments(cart.total, input.payments);
  if (!pay.ok) throw badRequest('PAYMENT_INVALID', pay.reason);

  // 3. Friendly pre-check: EVERY short line at once. NOT the guarantee (it can be stale a moment later).
  await assertStockAvailable(
    ctx,
    cart.lines.map((l) => ({ productId: l.productId, qty: l.qty, name: byId.get(l.productId)!.name })),
  );

  // 4. The transaction. Everything per-attempt is created INSIDE the callback: the driver may re-run it.
  try {
    const sale = await withTransaction(async (session) => {
      const now = ctx.now();
      const seq = await nextSeq(counterKeys.sale(ctx.branchId), session); // first, and inside: gapless
      const invoiceNo = `${ctx.branchCode}-${pad6(seq)}`;
      const saleId = new Types.ObjectId();

      const items = await withStockChanges(
        ctx,
        session,
        { refType: 'sale', refId: saleId, refNo: invoiceNo },
        async (stock) => {
          const out = [];
          for (const l of cart.lines) {
            const p = byId.get(l.productId)!;
            // The guarantee: { quantity: { $gte: qty } } + $inc in ONE operation. Returns avgCost as unitCost.
            const { unitCost } = await stock.out({
              branchId: ctx.branchId,
              productId: oid(l.productId),
              qty: l.qty,
              type: 'sale',
              name: p.name,
            });
            out.push({
              _id: new Types.ObjectId(), // the saleLineId returns will point to
              productId: oid(l.productId),
              sku: p.sku,
              name: p.name,
              qty: l.qty,
              unitPrice: l.unitPrice,
              unitCost, // snapshot: profit reports never look up today's cost
              discount: l.discount ?? null,
              lineDiscount: l.lineDiscount,
              cartShare: l.cartShare,
              net: l.net,
              tax: l.tax,
              total: l.total,
              returnedQty: 0,
            });
          }
          return out;
        },
      );

      const [doc] = await Sale.create(
        [
          {
            _id: saleId,
            branchId: ctx.branchId,
            branchCode: ctx.branchCode,
            invoiceNo,
            seq,
            clientSaleId: input.clientSaleId,
            cashierId: ctx.userId,
            cashierName: ctx.userName,
            items,
            discount: input.discount ?? null,
            taxRateBps: ctx.settings.taxRateBps,
            totals: {
              subtotal: cart.subtotal,
              discount: cart.discount,
              net: cart.net,
              tax: cart.tax,
              total: cart.total,
              cost: items.reduce((s, i) => s + i.unitCost * i.qty, 0),
              itemCount: cart.itemCount,
            },
            payments: input.payments,
            change: pay.change,
            customer: input.customer ?? {},
            note: input.note ?? '',
            businessDate: toBusinessDate(now, ctx.settings.timezone),
            createdAt: now,
          },
        ],
        { session }, // E11000 uniq_client_sale here → the WHOLE transaction (counter + stock) rolls back
      );
      return doc!.toObject();
    }, 'sale');
    return { sale: toSaleDto(sale, ctx), replayed: false };
  } catch (err) {
    // 5. Idempotency race path: the same clientSaleId committed in a parallel request.
    if (isDuplicateKey(err, 'uniq_client_sale')) {
      const original = await Sale.findOne({
        branchId: ctx.branchId,
        clientSaleId: input.clientSaleId,
      }).lean();
      if (original) return { sale: toSaleDto(original, ctx), replayed: true };
    }
    throw err;
  }
}

/* ---------- Day 13: history, detail, print count, shift summary (queries.md §12) ---------- */

/** Cashiers only ever see their OWN sales (◐): another cashier's sale is a 404, like another branch's. */
const visibleTo = (ctx: BranchCtx) => ({
  branchId: ctx.branchId,
  ...(!can(ctx.role, 'sale:viewAll') && { cashierId: ctx.userId }),
});

/** §12.1: newest first, (createdAt, _id) cursor: stable while new sales keep arriving. */
export async function listSales(ctx: BranchCtx, f: SalesListQuery): Promise<Page<SaleRowDto>> {
  const filter: Record<string, unknown> = visibleTo(ctx);
  if (f.cashierId && can(ctx.role, 'sale:viewAll')) filter.cashierId = oid(f.cashierId);
  if (f.invoiceNo) filter.invoiceNo = f.invoiceNo.toUpperCase();
  if (f.from || f.to) filter.businessDate = { ...(f.from && { $gte: f.from }), ...(f.to && { $lte: f.to }) };
  if (f.method) filter['payments.method'] = f.method;
  if (f.returnStatus) filter.returnStatus = f.returnStatus;
  if (f.cursor) Object.assign(filter, olderThan(decodeCursor(f.cursor)));

  const limit = LIMITS.pageSize;
  const rows = await Sale.find(filter)
    .select(
      'invoiceNo cashierName totals.total totals.itemCount payments.method returnStatus businessDate createdAt',
    )
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toSaleRowDto),
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
}

/** Detail = the sale + (for those who may open them) links to its returns. */
async function saleDetail(ctx: BranchCtx, sale: Parameters<typeof toSaleDto>[0]): Promise<SaleDto> {
  const dto = toSaleDto(sale, ctx); // strips unitCost / totals.cost for cashiers (NFR-SEC-14)
  if (can(ctx.role, 'return:view')) dto.returns = await returnsForSale(ctx, sale._id);
  return dto;
}

/** §12.2: by id. Another branch's sale or another cashier's: the same 404. */
export async function getSale(ctx: BranchCtx, id: Types.ObjectId): Promise<SaleDto> {
  const sale = await Sale.findOne({ _id: id, ...visibleTo(ctx) }).lean();
  if (!sale) throw notFound('Sale not found.');
  return saleDetail(ctx, sale);
}

/** §12.2: by invoice number (returns desk, history search). */
export async function getSaleByInvoice(ctx: BranchCtx, invoiceNo: string): Promise<SaleDto> {
  const sale = await Sale.findOne({ invoiceNo: invoiceNo.toUpperCase(), ...visibleTo(ctx) }).lean();
  if (!sale) throw notFound('Sale not found.');
  return saleDetail(ctx, sale);
}

/** §12.3 · FR-IVC-04: atomic $inc; the document BEFORE the update says whether this is the first print. */
export async function markPrinted(ctx: BranchCtx, id: Types.ObjectId): Promise<{ copy: boolean }> {
  const before = await Sale.findOneAndUpdate(
    { _id: id, ...visibleTo(ctx) },
    { $inc: { printCount: 1 } },
    { returnDocument: 'before', projection: { printCount: 1 } },
  ).lean();
  if (!before) throw notFound('Sale not found.');
  return { copy: (before.printCount ?? 0) > 0 };
}

type ShiftFacet = {
  totals: { count: number; total: number; items: number }[];
  byMethod: { _id: PaymentMethod; amount: number }[];
};

/** §12.4 · FR-SAL-12: the actor's own sales with TODAY's business date (shop timezone). */
export async function myShiftSummary(ctx: BranchCtx): Promise<ShiftSummaryDto> {
  const businessDate = toBusinessDate(ctx.now(), ctx.settings.timezone);
  const [res] = await Sale.aggregate<ShiftFacet>([
    { $match: { branchId: ctx.branchId, cashierId: ctx.userId, businessDate } },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              total: { $sum: '$totals.total' },
              items: { $sum: '$totals.itemCount' },
            },
          },
        ],
        byMethod: [
          { $unwind: '$payments' },
          {
            $group: {
              _id: '$payments.method',
              // Cash COLLECTED = cash tendered − change given (the drawer count at the end of the shift)
              amount: {
                $sum: {
                  $cond: [
                    { $eq: ['$payments.method', 'cash'] },
                    { $subtract: ['$payments.amount', '$change'] },
                    '$payments.amount',
                  ],
                },
              },
            },
          },
        ],
      },
    },
  ]);
  const t = res?.totals[0] ?? { count: 0, total: 0, items: 0 };
  return {
    businessDate,
    count: t.count,
    total: t.total,
    items: t.items,
    byMethod: Object.fromEntries((res?.byMethod ?? []).map((m) => [m._id, m.amount])),
  };
}
