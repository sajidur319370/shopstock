import type { Types } from 'mongoose';
import {
  LIMITS,
  type CreateProductInput,
  type ProductListQuery,
  type UpdateProductInput,
} from '@shopstock/shared';
import { Category, Product } from '../../db/models';
import { decodeNameCursor, encodeNameCursor } from '../../lib/cursor';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { oid } from '../../lib/ids';
import { escapeRegex } from '../../lib/regex';
import type { Ctx } from '../../types/ctx';
import { PRODUCT_CARD, toProductDto } from './catalog.dto';

async function assertCategory(id: string) {
  if (!(await Category.exists({ _id: oid(id) }))) throw badRequest('INVALID_CATEGORY', 'Unknown category.');
}

export async function getProduct(id: Types.ObjectId) {
  const p = await Product.findById(id).select(PRODUCT_CARD).lean();
  if (!p) throw notFound();
  return toProductDto(p); // Day 8 adds stock per branch (queries.md §7.3)
}

export async function createProduct(ctx: Ctx, input: CreateProductInput) {
  await assertCategory(input.categoryId);
  if ((await Product.estimatedDocumentCount()) >= LIMITS.products) {
    throw conflict('PRODUCT_LIMIT', 'Catalog is full.');
  }
  const p = await Product.create({
    ...input,
    categoryId: oid(input.categoryId),
    barcode: input.barcode ?? null,
    createdBy: ctx.userId,
  });
  return toProductDto(p.toObject()); // E11000 uniq_sku / uniq_barcode → 409 SKU_TAKEN / BARCODE_TAKEN
}

export async function updateProduct(ctx: Ctx, id: Types.ObjectId, input: UpdateProductInput) {
  if (input.categoryId) await assertCategory(input.categoryId);
  const current = await Product.findById(id).select('price').lean();
  if (!current) throw notFound();

  const $set: Record<string, unknown> = { ...input, updatedBy: ctx.userId };
  if (input.categoryId) $set.categoryId = oid(input.categoryId);
  if (input.name) $set.nameLower = input.name.toLowerCase(); // updates skip pre('validate')
  if (input.price !== undefined && input.price !== current.price) $set.priceUpdatedAt = ctx.now(); // FR-CAT-04

  const p = await Product.findByIdAndUpdate(id, { $set }, { returnDocument: 'after', runValidators: true })
    .select(PRODUCT_CARD)
    .lean();
  if (!p) throw notFound();
  return toProductDto(p);
}

export async function deleteProduct(id: Types.ObjectId) {
  // Day 8 adds: if (await Inventory.exists({ productId: id }).setOptions({ skipBranchCheck: 'product-in-use-check' }))
  //   throw conflict('PRODUCT_IN_USE', 'This product has stock history. Archive it instead.');
  const r = await Product.deleteOne({ _id: id });
  if (r.deletedCount === 0) throw notFound();
}

/**
 * A→Z by name, LIMITS.pageSize per page. Name cursor: two products with the exact same name would
 * be split across a page boundary only if they straddle it ($gt skips the twin); acceptable in a shop.
 */
export async function listProducts(f: ProductListQuery) {
  const filter: Record<string, unknown> = {};
  if (f.active !== 'all') filter.isActive = f.active === 'true';
  if (f.categoryId) filter.categoryId = oid(f.categoryId);
  const name: Record<string, unknown> = {};
  if (f.q) name.$regex = `^${escapeRegex(f.q.toLowerCase())}`;
  if (f.cursor) name.$gt = decodeNameCursor(f.cursor).nameLower;
  if (Object.keys(name).length) filter.nameLower = name;

  const rows = await Product.find(filter)
    .select(PRODUCT_CARD)
    .sort({ nameLower: 1 })
    .limit(LIMITS.pageSize + 1)
    .lean();
  const page = rows.slice(0, LIMITS.pageSize);
  const last = page.at(-1);
  return {
    items: page.map(toProductDto),
    nextCursor:
      rows.length > LIMITS.pageSize && last ? encodeNameCursor(last.nameLower, String(last._id)) : null,
  };
}
