import type { Types } from 'mongoose';
import { Inventory } from '../../db/models';

export interface Mismatch {
  productId: Types.ObjectId;
  quantity: number;
  sumOfMovements: number;
  lastQuantityAfter: number;
  movements: number;
}

/**
 * For every inventory row of a branch (queries.md §21):
 *   primary   Σ qtyChange == quantity        (exact, independent of ordering)
 *   secondary newest quantityAfter == quantity
 * Returns the rows that break either. An empty array means the audit trail explains every unit.
 */
export async function reconcile(
  ctx: { branchId: Types.ObjectId },
  productId?: Types.ObjectId,
): Promise<Mismatch[]> {
  return Inventory.aggregate<Mismatch>([
    { $match: { branchId: ctx.branchId, ...(productId && { productId }) } },
    {
      $lookup: {
        from: 'stockMovements',
        let: { pid: '$productId' },
        pipeline: [
          // The guard doesn't inspect sub-pipelines: this branch $match is the rule (queries.md §1.2).
          {
            $match: {
              $expr: { $and: [{ $eq: ['$branchId', ctx.branchId] }, { $eq: ['$productId', '$$pid'] }] },
            },
          },
          { $sort: { createdAt: -1, _id: -1 } },
          {
            $group: {
              _id: null,
              sum: { $sum: '$qtyChange' },
              lastAfter: { $first: '$quantityAfter' },
              count: { $sum: 1 },
            },
          },
        ],
        as: 'm',
      },
    },
    { $set: { m: { $ifNull: [{ $first: '$m' }, { sum: 0, lastAfter: 0, count: 0 }] } } },
    {
      $match: { $expr: { $or: [{ $ne: ['$m.sum', '$quantity'] }, { $ne: ['$m.lastAfter', '$quantity'] }] } },
    },
    {
      $project: {
        _id: 0,
        productId: 1,
        quantity: 1,
        sumOfMovements: '$m.sum',
        lastQuantityAfter: '$m.lastAfter',
        movements: '$m.count',
      },
    },
  ]);
}
