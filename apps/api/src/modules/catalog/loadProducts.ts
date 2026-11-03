import type { Types } from 'mongoose';
import { Product } from '../../db/models';
import { badRequest } from '../../lib/errors';
import { oid } from '../../lib/ids';

export type ProductSnapshot = { _id: Types.ObjectId; sku: string; name: string };

/**
 * The products of a document's lines (PO, transfer), keyed by id. Each product once, all active:
 * throws DUPLICATE_LINE / PRODUCT_INACTIVE (with the offending ids, so the UI can mark the lines).
 */
export async function loadActiveProducts(ids: string[]): Promise<Map<string, ProductSnapshot>> {
  if (new Set(ids).size !== ids.length)
    throw badRequest('DUPLICATE_LINE', 'Each product may appear only once.');
  const rows = await Product.find({ _id: { $in: ids.map(oid) } })
    .select('sku name isActive')
    .lean();
  const byId = new Map(rows.map((p) => [String(p._id), p]));
  const inactive = ids.filter((id) => !byId.get(id)?.isActive);
  if (inactive.length) {
    throw badRequest(
      'PRODUCT_INACTIVE',
      'Some products are archived or missing.',
      inactive.map((productId) => ({ productId })),
    );
  }
  return new Map(rows.map((p) => [String(p._id), { _id: p._id, sku: p.sku, name: p.name }]));
}
