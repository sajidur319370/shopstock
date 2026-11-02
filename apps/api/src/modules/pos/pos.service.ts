import type { PosSearchResponse } from '@shopstock/shared';
import { Inventory } from '../../db/models';
import type { BranchCtx } from '../../types/ctx';
import { toProductDto } from '../catalog/catalog.dto';
import { searchProducts } from '../catalog/search.service';

/** The catalog search + on-hand at THIS branch, in two indexed queries (queries.md §7.2). Never cost. */
export async function posSearch(ctx: BranchCtx, q: string): Promise<PosSearchResponse> {
  const { results, exact } = await searchProducts(q);
  const stock = await Inventory.find({
    branchId: ctx.branchId,
    productId: { $in: results.map((p) => p._id) },
  })
    .select('productId quantity')
    .lean();
  const onHand = new Map(stock.map((s) => [String(s.productId), s.quantity]));
  return {
    exactId: exact ? String(exact._id) : null,
    results: results.map((p) => ({ ...toProductDto(p), onHand: onHand.get(String(p._id)) ?? 0 })),
  };
}
