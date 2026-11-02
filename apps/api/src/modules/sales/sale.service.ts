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
  discountViolations,
  priceCart,
  settlePayments,
  toBusinessDate,
  type CreateSaleInput,
  type SaleDto,
} from '@shopstock/shared';
import { Product, Sale } from '../../db/models';
import { counterKeys, nextSeq } from '../../db/counters';
import { withTransaction } from '../../db/transaction';
import { badRequest, conflict, forbidden } from '../../lib/errors';
import { oid, pad6 } from '../../lib/ids';
import { isDuplicateKey } from '../../lib/mongoErrors';
import { discountCapFor, type BranchCtx } from '../../types/ctx';
import { assertStockAvailable, withStockChanges } from '../inventory/stock';
import { toSaleDto } from './sale.dto';

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
