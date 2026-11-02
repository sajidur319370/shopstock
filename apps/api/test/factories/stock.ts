import type { AdjustmentResultDto } from '@shopstock/shared';
import { as } from '../helpers/auth';

/** Opening balance via the real API, so movements and WAC are exactly what the app produces. */
export async function stockUp(
  token: string,
  branchCode: string,
  lines: { productId: string; qty: number; unitCost: number }[],
) {
  const res = await as(token)
    .post(`/api/b/${branchCode}/adjustments`)
    .send({
      reason: 'opening_balance',
      lines: lines.map((l) => ({ productId: l.productId, qtyChange: l.qty, unitCost: l.unitCost })),
    });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body as AdjustmentResultDto;
}
