import { randomUUID } from 'node:crypto';
import type { CreateSaleInput, Discount } from '@shopstock/shared';
import { as } from '../helpers/auth';
import { makeCategory, makeProduct } from './catalog';
import { makeShop } from './shop';
import { stockUp } from './stock';

export type LineIn = { productId: string; qty: number; discount?: Discount | null };

/**
 * Sells with "a billion in cash" unless payments are given (change is computed; payment rules have
 * their own tests). Returns the raw response: tests assert status codes.
 */
export async function sell(
  token: string,
  code: string,
  lines: LineIn[],
  opts: Partial<CreateSaleInput> = {},
) {
  const body = {
    clientSaleId: randomUUID(),
    lines,
    payments: [{ method: 'cash', amount: 1_000_000_000 }],
    ...opts,
  };
  return as(token).post(`/api/b/${code}/sales`).send(body);
}

/** A shop with one product stocked at GUL: the usual starting point. */
export async function shopWithStock(qty: number, opts: { price?: number; cost?: number } = {}) {
  const s = await makeShop();
  const cat = await makeCategory(s.owner.token);
  const product = await makeProduct(s.owner.token, {
    categoryId: cat.id,
    name: 'Soybean Oil 1L',
    price: opts.price ?? 18500,
  });
  if (qty > 0)
    await stockUp(s.owner.token, 'GUL', [{ productId: product.id, qty, unitCost: opts.cost ?? 16000 }]);
  return { ...s, product };
}
