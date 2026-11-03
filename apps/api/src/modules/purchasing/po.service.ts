/**
 * Purchase orders (queries.md §14). A state machine where EVERY transition is a compare-and-set:
 *   findOneAndUpdate({ _id, branchId, status: { $in: allowedFrom } }, { $set: { status: next } })
 * There is no "read the status, check it in Node, then write" window for a second manager to slip into.
 *
 *   draft ──order──► ordered ──receive──► partially_received ──receive──► received
 *     │ delete          │ cancel (nothing received)   │ close (the rest won't come)
 */
import type { Types } from 'mongoose';
import {
  LIMITS,
  PO_OPEN_STATUSES,
  toBusinessDate,
  type CreatePOInput,
  type Page,
  type PODto,
  type PORowDto,
  type POListQuery,
  type POSuggestionDto,
  type PoStatus,
  type ReceivePOInput,
  type UpdatePOInput,
} from '@shopstock/shared';
import { PurchaseOrder, StockMovement, Supplier } from '../../db/models';
import { counterKeys, nextSeq } from '../../db/counters';
import { withTransaction } from '../../db/transaction';
import { decodeCursor, encodeCursor, olderThan } from '../../lib/cursor';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { oid } from '../../lib/ids';
import { notFoundOrInvalidState } from '../../lib/states';
import type { BranchCtx } from '../../types/ctx';
import { loadActiveProducts } from '../catalog/loadProducts';
import { withStockChanges } from '../inventory/stock';
import { lowStock } from '../inventory/lowStock.service';
import { toPODto, toPORowDto } from './po.dto';

const isOpen = (s: string | null | undefined) => (PO_OPEN_STATUSES as readonly string[]).includes(s ?? '');

async function activeSupplier(id: string) {
  const sup = await Supplier.findOne({ _id: oid(id), isActive: true })
    .select('name')
    .lean();
  if (!sup) throw badRequest('INVALID_SUPPLIER', 'Choose an active supplier.');
  return sup;
}

/** Fresh snapshots of sku/name; receivedQty starts at 0. */
async function toPOItems(lines: CreatePOInput['lines']) {
  const products = await loadActiveProducts(lines.map((l) => l.productId)); // PRODUCT_INACTIVE / DUPLICATE_LINE
  return lines.map((l) => {
    const p = products.get(l.productId)!;
    return {
      productId: p._id,
      sku: p.sku,
      name: p.name,
      orderedQty: l.orderedQty,
      receivedQty: 0,
      unitCost: l.unitCost,
    };
  });
}

/** FR-PO-01: "not in the past" means the SHOP's today, so it's checked here and not in Zod. */
function assertNotPast(ctx: BranchCtx, date: string | null | undefined): string | null {
  if (!date) return null;
  if (date < toBusinessDate(ctx.now(), ctx.settings.timezone)) {
    throw badRequest('EXPECTED_DATE_PAST', 'The expected date cannot be in the past.');
  }
  return date;
}

/* ---------- §14.1 create a draft ---------- */

export async function createPO(ctx: BranchCtx, input: CreatePOInput): Promise<PODto> {
  const supplier = await activeSupplier(input.supplierId);
  const items = await toPOItems(input.lines);
  const expectedDate = assertNotPast(ctx, input.expectedDate);

  const year = Number(toBusinessDate(ctx.now(), ctx.settings.timezone).slice(0, 4));
  const seq = await nextSeq(counterKeys.po(year)); // OUTSIDE a transaction: a failed insert leaves a gap (fine for POs)
  const po = await PurchaseOrder.create({
    branchId: ctx.branchId,
    poNumber: `PO-${year}-${String(seq).padStart(4, '0')}`,
    supplierId: supplier._id,
    supplierName: supplier.name,
    status: 'draft',
    items,
    expectedDate,
    notes: input.notes,
    createdBy: ctx.userId,
  });
  return toPODto(po.toObject());
}

/* ---------- draft-only edits: the same CAS idea ---------- */

export async function updateDraft(ctx: BranchCtx, id: Types.ObjectId, input: UpdatePOInput): Promise<PODto> {
  const $set: Record<string, unknown> = {};
  if (input.supplierId) {
    const sup = await activeSupplier(input.supplierId);
    Object.assign($set, { supplierId: sup._id, supplierName: sup.name });
  }
  if (input.lines) $set.items = await toPOItems(input.lines);
  if (input.expectedDate !== undefined) $set.expectedDate = assertNotPast(ctx, input.expectedDate);
  if (input.notes !== undefined) $set.notes = input.notes;

  const po = await PurchaseOrder.findOneAndUpdate(
    { _id: id, branchId: ctx.branchId, status: 'draft' },
    { $set },
    { returnDocument: 'after', runValidators: true },
  ).lean();
  if (!po) throw await notFoundOrInvalidState(PurchaseOrder, { _id: id, branchId: ctx.branchId }); // 404 or 409
  return toPODto(po);
}

export async function deleteDraft(ctx: BranchCtx, id: Types.ObjectId): Promise<void> {
  const r = await PurchaseOrder.deleteOne({ _id: id, branchId: ctx.branchId, status: 'draft' });
  if (r.deletedCount === 0)
    throw await notFoundOrInvalidState(PurchaseOrder, { _id: id, branchId: ctx.branchId });
}

/* ---------- §14.2 transitions (compare-and-set) ---------- */

async function transition(
  ctx: BranchCtx,
  id: Types.ObjectId,
  from: PoStatus[],
  set: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<PODto> {
  const po = await PurchaseOrder.findOneAndUpdate(
    { _id: id, branchId: ctx.branchId, status: { $in: from }, ...extra },
    { $set: set },
    { returnDocument: 'after' },
  ).lean();
  if (!po) throw await notFoundOrInvalidState(PurchaseOrder, { _id: id, branchId: ctx.branchId });
  return toPODto(po);
}

/** FR-PO-04: draft → ordered. */
export const orderPO = (ctx: BranchCtx, id: Types.ObjectId) =>
  transition(ctx, id, ['draft'], { status: 'ordered', orderedAt: ctx.now() });

/** FR-PO-07: draft/ordered → cancelled, only while NO line has anything received. */
export const cancelPO = (ctx: BranchCtx, id: Types.ObjectId) =>
  transition(
    ctx,
    id,
    ['draft', 'ordered'],
    { status: 'cancelled', cancelledAt: ctx.now() },
    { items: { $not: { $elemMatch: { receivedQty: { $gt: 0 } } } } },
  );

/** FR-PO-08: partially_received → closed (the rest won't come). */
export const closePO = (ctx: BranchCtx, id: Types.ObjectId) =>
  transition(ctx, id, ['partially_received'], { status: 'closed', closedAt: ctx.now() });

/* ---------- §14.3 receive a delivery · FR-PO-05 ---------- */

export async function receivePO(
  ctx: BranchCtx,
  poId: Types.ObjectId,
  input: ReceivePOInput,
): Promise<{ purchaseOrder: PODto; replayed: boolean }> {
  const po = await PurchaseOrder.findOne({ _id: poId, branchId: ctx.branchId }).lean();
  if (!po) throw notFound('Purchase order not found.');
  // Idempotency fast path: this delivery was already recorded.
  if (po.receipts.some((r) => r.clientReceiptId === input.clientReceiptId)) {
    return { purchaseOrder: toPODto(po), replayed: true };
  }
  if (!isOpen(po.status)) {
    throw conflict('INVALID_STATE', `This purchase order is ${String(po.status).replace('_', ' ')}.`, {
      status: po.status,
    });
  }

  // Friendly pre-check: every line is on the PO and fits in what's left. NOT the guarantee.
  const lines = input.lines.map((l) => {
    const item = po.items.find((i) => String(i.productId) === l.productId);
    if (!item) {
      throw badRequest('INVALID_LINE', 'That product is not on this purchase order.', [
        { productId: l.productId },
      ]);
    }
    const left = item.orderedQty - (item.receivedQty ?? 0);
    if (l.qty > left) {
      throw conflict('RECEIVE_EXCEEDS_ORDERED', `Only ${left} of "${item.name}" are still expected.`, [
        { productId: l.productId, remaining: left },
      ]);
    }
    return { qty: l.qty, item, unitCost: l.unitCost ?? item.unitCost };
  });

  const result = await withTransaction(async (session) => {
    const now = ctx.now();
    // 1. Claim this receipt id, check the state and the receipt limit: ONE atomic write, and the FIRST one.
    const claimed = await PurchaseOrder.updateOne(
      {
        _id: poId,
        branchId: ctx.branchId,
        status: { $in: PO_OPEN_STATUSES },
        'receipts.clientReceiptId': { $ne: input.clientReceiptId },
        [`receipts.${LIMITS.receiptsPerPo - 1}`]: { $exists: false }, // index 19 exists = 20 receipts already
      },
      {
        $push: {
          receipts: {
            clientReceiptId: input.clientReceiptId,
            receivedAt: now,
            receivedBy: ctx.userId,
            receivedByName: ctx.userName,
            lines: lines.map((l) => ({ productId: l.item.productId, qty: l.qty, unitCost: l.unitCost })),
            note: input.note,
          },
        },
      },
      { session },
    );
    if (claimed.modifiedCount === 0) return 'not-claimed' as const;

    // 2. Each line: conditional receivedQty (the guarantee), then stock in at the receipt cost (WAC).
    await withStockChanges(
      ctx,
      session,
      { refType: 'purchaseOrder', refId: po._id, refNo: po.poNumber },
      async (stock) => {
        for (const l of lines) {
          const res = await PurchaseOrder.updateOne(
            {
              _id: poId,
              branchId: ctx.branchId,
              items: {
                $elemMatch: { productId: l.item.productId, receivedQty: { $lte: l.item.orderedQty - l.qty } },
              },
            },
            { $inc: { 'items.$.receivedQty': l.qty } },
            { session },
          );
          if (res.modifiedCount === 0) {
            throw conflict('RECEIVE_EXCEEDS_ORDERED', `"${l.item.name}" was received meanwhile.`, [
              { productId: String(l.item.productId) },
            ]);
          }
          await stock.in({
            branchId: ctx.branchId,
            productId: l.item.productId,
            qty: l.qty,
            unitCost: l.unitCost,
            type: 'purchase_receipt',
          });
        }
      },
    );

    // 3. The new status from the lines AS THIS TRANSACTION SEES THEM (its snapshot + its own writes).
    const after = await PurchaseOrder.findOne({ _id: poId, branchId: ctx.branchId })
      .select('items')
      .session(session)
      .lean();
    const complete = after!.items.every((i) => (i.receivedQty ?? 0) >= i.orderedQty);
    await PurchaseOrder.updateOne(
      { _id: poId, branchId: ctx.branchId },
      {
        $set: { status: complete ? 'received' : 'partially_received', ...(complete && { completedAt: now }) },
      },
      { session },
    );
    return 'applied' as const;
  }, 'po-receive');

  const fresh = await PurchaseOrder.findOne({ _id: poId, branchId: ctx.branchId }).lean();
  if (result === 'not-claimed') {
    // Either a parallel copy of this delivery won (a replay), or the state / receipt limit stopped it.
    if (fresh?.receipts.some((r) => r.clientReceiptId === input.clientReceiptId)) {
      return { purchaseOrder: toPODto(fresh), replayed: true };
    }
    throw conflict(
      'INVALID_STATE',
      fresh && isOpen(fresh.status)
        ? `A purchase order takes at most ${LIMITS.receiptsPerPo} deliveries.`
        : 'This purchase order can no longer be received.',
      { status: fresh?.status },
    );
  }
  return { purchaseOrder: toPODto(fresh!), replayed: false };
}

/* ---------- reading ---------- */

/** FR-PO-10: newest first, filtered by status and supplier. */
export async function listPOs(ctx: BranchCtx, f: POListQuery): Promise<Page<PORowDto>> {
  const filter: Record<string, unknown> = { branchId: ctx.branchId };
  if (f.status === 'open') filter.status = { $in: PO_OPEN_STATUSES };
  else if (f.status) filter.status = f.status;
  if (f.supplierId) filter.supplierId = oid(f.supplierId);
  if (f.cursor) Object.assign(filter, olderThan(decodeCursor(f.cursor)));

  const limit = LIMITS.pageSize;
  const rows = await PurchaseOrder.find(filter)
    .select('poNumber supplierId supplierName status items.orderedQty items.unitCost expectedDate createdAt')
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toPORowDto),
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
}

export async function getPO(ctx: BranchCtx, id: Types.ObjectId): Promise<PODto> {
  const po = await PurchaseOrder.findOne({ _id: id, branchId: ctx.branchId }).lean();
  if (!po) throw notFound('Purchase order not found.');
  return toPODto(po);
}

/* ---------- §14.4 suggestions from low stock · FR-PO-11 ---------- */

export async function suggestions(ctx: BranchCtx): Promise<POSuggestionDto[]> {
  const rows = await lowStock(ctx, {});
  if (!rows.length) return [];
  // The last purchase cost of each product at THIS branch, to pre-fill unitCost (one query, not N).
  const last = await StockMovement.aggregate<{ _id: Types.ObjectId; unitCost: number }>([
    {
      $match: {
        branchId: ctx.branchId,
        productId: { $in: rows.map((r) => r.productId) },
        type: 'purchase_receipt',
      },
    },
    { $sort: { createdAt: -1, _id: -1 } },
    { $group: { _id: '$productId', unitCost: { $first: '$unitCost' } } },
  ]);
  const lastCost = new Map(last.map((m) => [String(m._id), m.unitCost]));
  return rows.map((r) => ({
    productId: String(r.productId),
    sku: r.product.sku,
    name: r.product.name,
    unit: r.product.unit,
    quantity: r.quantity,
    reorderLevel: r.reorderLevel,
    status: r.status,
    suggestedQty: r.suggestedQty,
    lastCost: lastCost.get(String(r.productId)) ?? null,
  }));
}
