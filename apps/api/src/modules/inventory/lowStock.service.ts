import type { Types } from 'mongoose';
import type { Unit } from '@shopstock/shared';
import { Inventory } from '../../db/models';
import { oid } from '../../lib/ids';
import type { BranchCtx } from '../../types/ctx';

export type LowStockRow = {
  productId: Types.ObjectId;
  quantity: number;
  reorderLevel: number;
  status: 'low' | 'out';
  suggestedQty: number;
  product: { _id: Types.ObjectId; name: string; sku: string; unit: Unit; categoryId: Types.ObjectId };
};

/**
 * queries.md §8.2 · AP13: the branch's low and out-of-stock rows, most urgent first.
 * Built on Day 15 for PO suggestions; the dashboard reuses it on Day 18.
 */
export async function lowStock(
  ctx: BranchCtx,
  f: { status?: 'low' | 'out'; categoryId?: string; limit?: number },
): Promise<LowStockRow[]> {
  const isOut = { $eq: ['$quantity', 0] };
  const isLow = {
    $and: [
      { $gt: ['$reorderLevel', 0] },
      { $gt: ['$quantity', 0] },
      { $lte: ['$quantity', '$reorderLevel'] },
    ],
  };
  const cond = f.status === 'out' ? isOut : f.status === 'low' ? isLow : { $or: [isOut, isLow] };

  return Inventory.aggregate<LowStockRow>([
    // Equality on branchId uses the index; the two-field comparison is evaluated while scanning one branch.
    { $match: { branchId: ctx.branchId, $expr: cond } },
    {
      $lookup: {
        from: 'products',
        localField: 'productId',
        foreignField: '_id',
        pipeline: [
          { $match: { isActive: true, ...(f.categoryId && { categoryId: oid(f.categoryId) }) } },
          { $project: { name: 1, sku: 1, unit: 1, categoryId: 1 } },
        ],
        as: 'product',
      },
    },
    { $unwind: '$product' }, // drops archived products / other categories
    {
      $addFields: {
        status: { $cond: [isOut, 'out', 'low'] },
        ratio: { $cond: [{ $gt: ['$reorderLevel', 0] }, { $divide: ['$quantity', '$reorderLevel'] }, 0] },
        suggestedQty: { $max: [{ $subtract: [{ $multiply: ['$reorderLevel', 2] }, '$quantity'] }, 1] }, // FR-PO-11
      },
    },
    { $sort: { ratio: 1, 'product.name': 1 } },
    ...(f.limit ? [{ $limit: f.limit }] : []),
    {
      $project: {
        _id: 0,
        productId: 1,
        quantity: 1,
        reorderLevel: 1,
        status: 1,
        suggestedQty: 1,
        product: 1,
      },
    },
  ]);
}
