import type { PipelineStage, Types } from 'mongoose';
import type { LowStockRowDto, LowStockSummaryDto, Unit } from '@shopstock/shared';
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
 * data-model.md §11.6. Out = nothing on the shelf. Low = some, at or under a reorder level > 0
 * (a level of 0 means "don't alert"). A product never stocked here has NO row, so it is never "out"
 * at this branch (FR-DSH-06): that falls out of starting from `inventory`.
 */
const IS_OUT = { $eq: ['$quantity', 0] };
const IS_LOW = {
  $and: [{ $gt: ['$reorderLevel', 0] }, { $gt: ['$quantity', 0] }, { $lte: ['$quantity', '$reorderLevel'] }],
};

/** Joins the product (shop-wide, so no branch $match needed in the sub-pipeline); archived ones drop out. */
const withActiveProduct = (categoryId?: string): PipelineStage[] => [
  {
    $lookup: {
      from: 'products',
      localField: 'productId',
      foreignField: '_id',
      pipeline: [
        { $match: { isActive: true, ...(categoryId && { categoryId: oid(categoryId) }) } },
        { $project: { name: 1, sku: 1, unit: 1, categoryId: 1 } },
      ],
      as: 'product',
    },
  },
  { $unwind: '$product' },
];

/** Most urgent first: the smallest share of the reorder level left. */
const ranked: PipelineStage.FacetPipelineStage[] = [
  {
    $addFields: {
      status: { $cond: [IS_OUT, 'out', 'low'] },
      ratio: { $cond: [{ $gt: ['$reorderLevel', 0] }, { $divide: ['$quantity', '$reorderLevel'] }, 0] },
      suggestedQty: { $max: [{ $subtract: [{ $multiply: ['$reorderLevel', 2] }, '$quantity'] }, 1] }, // FR-PO-11
    },
  },
  { $sort: { ratio: 1, 'product.name': 1, productId: 1 } },
];
const rowFields: PipelineStage.FacetPipelineStage = {
  $project: { _id: 0, productId: 1, quantity: 1, reorderLevel: 1, status: 1, suggestedQty: 1, product: 1 },
};

/**
 * queries.md §8.2 · AP13: the branch's low and out-of-stock rows, most urgent first.
 * Built on Day 15 for PO suggestions; the low-stock page uses it with a limit.
 */
export async function lowStock(
  ctx: BranchCtx,
  f: { status?: 'low' | 'out'; categoryId?: string; limit?: number },
): Promise<LowStockRow[]> {
  const cond = f.status === 'out' ? IS_OUT : f.status === 'low' ? IS_LOW : { $or: [IS_OUT, IS_LOW] };
  const pipeline: PipelineStage[] = [
    // Equality on branchId uses the index; the two-field comparison is evaluated while scanning one branch.
    { $match: { branchId: ctx.branchId, $expr: cond } },
    ...withActiveProduct(f.categoryId),
    ...ranked,
    ...(f.limit ? [{ $limit: f.limit }] : []),
    rowFields,
  ];
  return Inventory.aggregate<LowStockRow>(pipeline);
}

/** The dashboard variant: counts by status AND the 10 lowest, in ONE pipeline ($facet). */
export async function lowStockSummary(ctx: BranchCtx): Promise<LowStockSummaryDto> {
  const [r] = await Inventory.aggregate<{ counts: { _id: 'low' | 'out'; n: number }[]; top: LowStockRow[] }>([
    { $match: { branchId: ctx.branchId, $expr: { $or: [IS_OUT, IS_LOW] } } },
    ...withActiveProduct(),
    {
      $facet: {
        counts: [{ $group: { _id: { $cond: [IS_OUT, 'out', 'low'] }, n: { $sum: 1 } } }],
        top: [...ranked, { $limit: 10 }, rowFields],
      },
    },
  ]);
  const count = (s: 'low' | 'out') => r?.counts.find((c) => c._id === s)?.n ?? 0;
  return { lowCount: count('low'), outCount: count('out'), top: (r?.top ?? []).map(toLowStockRowDto) };
}

export const toLowStockRowDto = (r: LowStockRow): LowStockRowDto => ({
  productId: String(r.productId),
  sku: r.product.sku,
  name: r.product.name,
  unit: r.product.unit,
  categoryId: String(r.product.categoryId),
  quantity: r.quantity,
  reorderLevel: r.reorderLevel,
  status: r.status,
  suggestedQty: r.suggestedQty,
});
