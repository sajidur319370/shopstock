/**
 * queries.md §22.1, built through the REAL services with a controlled clock (the technique the Day 20
 * seed uses): every number in fixtures/reports.json was calculated by hand from these events.
 */
import { randomUUID } from 'node:crypto';
import type { CreateSaleInput, Discount } from '@shopstock/shared';
import { invalidateCache } from '../../src/lib/cache';
import { createAdjustment } from '../../src/modules/inventory/adjustment.service';
import { createReturn } from '../../src/modules/returns/return.service';
import { createSale } from '../../src/modules/sales/sale.service';
import type { BranchCtx } from '../../src/types/ctx';
import { as } from '../helpers/auth';
import { ownerCtxFor } from '../helpers/ctx';
import { at } from '../helpers/report';
import { makeCategory, makeProduct } from '../factories/catalog';
import { makeShop } from '../factories/shop';

const cash = [{ method: 'cash' as const, amount: 1_000_000_000 }];

export async function buildReportFixture() {
  const s = await makeShop();
  await as(s.owner.token).patch('/api/settings').send({ taxRateBps: 500 });
  invalidateCache();
  const cat = await makeCategory(s.owner.token);
  const [p1, p2, p3] = await Promise.all([
    makeProduct(s.owner.token, { categoryId: cat.id, sku: 'P1', name: 'Tea 400g', price: 30000 }),
    makeProduct(s.owner.token, { categoryId: cat.id, sku: 'P2', name: 'Sugar 1kg', price: 12000 }),
    makeProduct(s.owner.token, { categoryId: cat.id, sku: 'P3', name: 'Soap', price: 5000 }),
  ]);
  const gul = (day: string) => ownerCtxFor(s.gul._id, 'GUL', at(day));
  const dhn = (day: string) => ownerCtxFor(s.dhn._id, 'DHN', at(day));
  const sale = async (
    ctx: Promise<BranchCtx>,
    lines: CreateSaleInput['lines'],
    discount: Discount | null = null,
  ) => (await createSale(await ctx, { clientSaleId: randomUUID(), lines, discount, payments: cash })).sale;

  // Opening balances on 2026-09-30 at both branches (NOT shrinkage)
  for (const ctx of [gul('2026-09-30'), dhn('2026-09-30')]) {
    await createAdjustment(await ctx, {
      reason: 'opening_balance',
      note: '',
      lines: [
        { productId: p1.id, qtyChange: 50, unitCost: 20000 },
        { productId: p2.id, qtyChange: 100, unitCost: 9000 },
        { productId: p3.id, qtyChange: 100, unitCost: 3000 },
      ],
    });
  }

  // In DATE order, like real life: a movement written with an earlier clock AFTER a later one would
  // break "the latest movement's quantityAfter = quantity" (reconciliation). The seed does the same.

  // 2026-10-01
  await sale(gul('2026-10-01'), [{ productId: p1.id, qty: 2 }]); // S1
  await sale(gul('2026-10-01'), [{ productId: p2.id, qty: 5 }], { type: 'percent', bps: 1000 }); // S2 cart 10%
  await sale(dhn('2026-10-01'), [{ productId: p1.id, qty: 3 }]); // S6

  // 2026-10-02
  const s3 = await sale(gul('2026-10-02'), [{ productId: p3.id, qty: 10 }]); // S3
  await sale(gul('2026-10-02'), [
    { productId: p1.id, qty: 1 },
    { productId: p3.id, qty: 2 },
  ]); // S4
  await sale(dhn('2026-10-02'), [{ productId: p2.id, qty: 10 }]); // S7
  await createAdjustment(await dhn('2026-10-02'), {
    // A1: one tea damaged at DHN (shrinkage −20000)
    reason: 'damaged',
    note: '',
    lines: [{ productId: p1.id, qtyChange: -1 }],
  });

  // 2026-10-03
  await sale(gul('2026-10-03'), [{ productId: p2.id, qty: 3, discount: { type: 'amount', amount: 1000 } }]); // S5
  await sale(dhn('2026-10-03'), [
    { productId: p3.id, qty: 4 },
    { productId: p2.id, qty: 1 },
  ]); // S8
  await sale(dhn('2026-10-03'), [{ productId: p1.id, qty: 1, discount: { type: 'percent', bps: 500 } }]); // S9
  await createReturn(await gul('2026-10-03'), {
    // R1: 2 of S3's soap, restocked, on the 3rd (S3 was on the 2nd)
    clientReturnId: randomUUID(),
    saleId: s3.id,
    reason: 'changed_mind',
    note: '',
    lines: [{ saleLineId: s3.items[0]!.id, qty: 2, restock: true }],
  });

  return { s, cat, p1, p2, p3 };
}
