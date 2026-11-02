import type { Types } from 'mongoose';
import { LIMITS, can, type BranchStockDto, type InventoryListQuery } from '@shopstock/shared';
import { Inventory, Product } from '../../db/models';
import { listBranches } from '../../lib/cache';
import { decodeNameCursor, encodeNameCursor } from '../../lib/cursor';
import { notFound } from '../../lib/errors';
import { oid } from '../../lib/ids';
import { escapeRegex } from '../../lib/regex';
import type { BranchCtx, Ctx } from '../../types/ctx';
import { seesCost, stockStatus, toInventoryRowDto } from './inventory.dto';
import { listMovements } from './movement.service';

const PRODUCT_FIELDS = '_id sku name nameLower unit categoryId reorderLevel';
const ROW_FIELDS = 'productId quantity avgCost reorderLevel';

/**
 * Walks the CATALOG in name order and attaches this branch's stock (queries.md §8.1), so products
 * never stocked here show up as "Not stocked": exactly what a manager needs for opening stock.
 */
export async function listInventory(ctx: BranchCtx, f: InventoryListQuery) {
  const filter: Record<string, unknown> = { isActive: true };
  if (f.categoryId) filter.categoryId = oid(f.categoryId);
  const name: Record<string, unknown> = {};
  if (f.q) name.$regex = `^${escapeRegex(f.q.toLowerCase())}`;
  if (f.cursor) name.$gt = decodeNameCursor(f.cursor).nameLower;
  if (Object.keys(name).length) filter.nameLower = name;

  const products = await Product.find(filter)
    .select(PRODUCT_FIELDS)
    .sort({ nameLower: 1 })
    .limit(LIMITS.pageSize + 1)
    .lean();
  const page = products.slice(0, LIMITS.pageSize);

  const rows = await Inventory.find({ branchId: ctx.branchId, productId: { $in: page.map((p) => p._id) } })
    .select(ROW_FIELDS)
    .lean();
  const byProduct = new Map(rows.map((r) => [String(r.productId), r]));
  const last = page.at(-1);

  return {
    items: page.map((p) => toInventoryRowDto(p, byProduct.get(String(p._id)) ?? null, ctx)), // strips cost for cashiers
    nextCursor:
      products.length > LIMITS.pageSize && last ? encodeNameCursor(last.nameLower, String(last._id)) : null,
  };
}

/** One product at this branch + its last 10 movements (only with movement:view). Archived products too. */
export async function getInventoryRow(ctx: BranchCtx, productId: Types.ObjectId) {
  const product = await Product.findById(productId).select(PRODUCT_FIELDS).lean();
  if (!product) throw notFound();
  const row = await Inventory.findOne({ branchId: ctx.branchId, productId }).select(ROW_FIELDS).lean();
  const movements = can(ctx.role, 'movement:view')
    ? (await listMovements(ctx, { productId: String(productId) }, 10)).items
    : undefined;
  return { row: toInventoryRowDto(product, row, ctx), movements };
}

/**
 * Doesn't change `quantity`, so it doesn't go through the stock module and writes no movement
 * (queries.md §8.3). A product never stocked here has no row: set the product's default instead.
 */
export async function setReorderLevel(ctx: BranchCtx, productId: Types.ObjectId, reorderLevel: number) {
  const res = await Inventory.updateOne({ branchId: ctx.branchId, productId }, { $set: { reorderLevel } });
  if (res.matchedCount === 0) throw notFound('This product has no stock at this branch yet.');
  return getInventoryRow(ctx, productId);
}

/** Product detail: this product at each of MY branches (queries.md §7.3). Cost only for Manager+. */
export async function stockAcrossMyBranches(ctx: Ctx, productId: Types.ObjectId): Promise<BranchStockDto[]> {
  const rows = await Inventory.find({ productId, branchId: { $in: ctx.branchIds } })
    .select('branchId quantity avgCost reorderLevel')
    .lean();
  const codes = new Map((await listBranches()).map((b) => [String(b._id), b.code]));
  return rows
    .map((r) => {
      const dto: BranchStockDto = {
        branchId: String(r.branchId),
        branchCode: codes.get(String(r.branchId)) ?? '?',
        quantity: r.quantity,
        reorderLevel: r.reorderLevel ?? 0,
        status: stockStatus(r),
      };
      if (seesCost(ctx)) dto.avgCost = r.avgCost;
      return dto;
    })
    .sort((a, b) => a.branchCode.localeCompare(b.branchCode));
}

/** FR-CAT-06: a product with any stock history anywhere can't be deleted (archive it instead). */
export async function productHasStockHistory(productId: Types.ObjectId) {
  // Approved bypass (data-model.md §2.3): the question is about ALL branches, on purpose.
  return !!(await Inventory.exists({ productId }).setOptions({ skipBranchCheck: 'product-in-use-check' }));
}
