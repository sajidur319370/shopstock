import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { as } from './helpers/auth';
import { ownerCtxFor } from './helpers/ctx';
import { makeCategory, makeProduct } from './factories/catalog';
import { sell, shopWithStock } from './factories/sales';
import { stockUp } from './factories/stock';
import { Inventory, Sale, StockMovement } from '../src/db/models';
import { createSale } from '../src/modules/sales/sale.service';

const oneOil = (s: { product: { id: string } }, qty = 2) => [{ productId: s.product.id, qty }];

describe('sale business rules', () => {
  it('a sale of 2 at stock 5: priced from the DB, cost snapshotted, one movement per line', async () => {
    const s = await shopWithStock(5);
    const res = await sell(s.managerGul.token, 'GUL', oneOil(s));
    expect(res.status).toBe(201);
    expect(res.body.replayed).toBe(false);
    expect(res.body.sale.items[0]).toMatchObject({ unitPrice: 18500, unitCost: 16000, qty: 2, net: 37000 });
    expect(res.body.sale.totals).toMatchObject({ subtotal: 37000, tax: 1850, total: 38850, cost: 32000 });
    expect((await Inventory.findOne({ branchId: s.gul._id }).lean())!.quantity).toBe(3);
    const moves = await StockMovement.find({ branchId: s.gul._id, type: 'sale' }).lean();
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      refType: 'sale',
      refNo: res.body.sale.invoiceNo,
      qtyChange: -2,
      quantityAfter: 3,
      unitCost: 16000,
    });
    expect(String(moves[0]!.refId)).toBe(res.body.sale.id);
  });

  it('a cashier gets NO cost fields', async () => {
    const s = await shopWithStock(5);
    const res = await sell(s.cashierGul.token, 'GUL', oneOil(s));
    expect(res.status).toBe(201);
    expect(res.body.sale.items[0]).not.toHaveProperty('unitCost');
    expect(res.body.sale.totals).not.toHaveProperty('cost');
    expect(JSON.stringify(res.body)).not.toMatch(/unitCost|"cost"/);
  });

  it('a client-sent unitPrice is ignored: the sale is priced at 18500', async () => {
    const s = await shopWithStock(5);
    const res = await sell(s.cashierGul.token, 'GUL', [
      { productId: s.product.id, qty: 1, unitPrice: 1 } as never,
    ]);
    expect(res.body.sale.items[0].unitPrice).toBe(18500);
  });

  it('discount caps by role (FR-PRC-04, AC-PRC-02)', async () => {
    const s = await shopWithStock(10);
    const pct = (bps: number) => ({ type: 'percent' as const, bps });
    const cashier15 = await sell(s.cashierGul.token, 'GUL', [
      { productId: s.product.id, qty: 1, discount: pct(1500) },
    ]);
    expect(cashier15.status).toBe(403);
    expect(cashier15.body.error).toMatchObject({ code: 'DISCOUNT_LIMIT', details: { capBps: 1000 } });
    const manager15 = await sell(s.managerGul.token, 'GUL', [
      { productId: s.product.id, qty: 1, discount: pct(1500) },
    ]);
    expect(manager15.status).toBe(201);
    const both = await sell(
      s.cashierGul.token,
      'GUL',
      [{ productId: s.product.id, qty: 1, discount: pct(1000) }],
      {
        discount: pct(1000),
      },
    );
    expect(both.status).toBe(403); // 10% + 10% of the rest = 19% overall
    expect(both.body.error.details.violations).toEqual([{ productId: null, rateBps: 1900 }]);
    expect(await Sale.countDocuments({ branchId: s.gul._id })).toBe(1);
  });

  it('expectedTotal ≠ server total → 409 PRICE_CHANGED with the new cart; nothing sold', async () => {
    const s = await shopWithStock(5);
    const seen = 38850; // what the POS showed: 2 × 18500 + 5% VAT (integers: never 37000 × 1.05)
    await as(s.owner.token).patch(`/api/products/${s.product.id}`).send({ price: 19000 }); // owner reprices
    const res = await sell(s.cashierGul.token, 'GUL', oneOil(s), { expectedTotal: seen });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRICE_CHANGED');
    expect(res.body.error.details.cart.total).toBe(39900);
    expect(await Sale.countDocuments({ branchId: s.gul._id })).toBe(0);
    expect((await Inventory.findOne({ branchId: s.gul._id }).lean())!.quantity).toBe(5);
    const confirmed = await sell(s.cashierGul.token, 'GUL', oneOil(s), { expectedTotal: 39900 });
    expect(confirmed.status).toBe(201);
  });

  it('payments: card above the total → 400 PAYMENT_INVALID; cash gives change', async () => {
    const s = await shopWithStock(5);
    const card = await sell(s.cashierGul.token, 'GUL', oneOil(s), {
      payments: [{ method: 'card', amount: 50000 }],
    });
    expect(card.status).toBe(400);
    expect(card.body.error.code).toBe('PAYMENT_INVALID');
    const cash = await sell(s.cashierGul.token, 'GUL', oneOil(s), {
      payments: [{ method: 'cash', amount: 50000 }],
    });
    expect(cash.body.sale).toMatchObject({ change: 11150, totals: { total: 38850 } }); // 2 × 18500 + 5% VAT
    const short = await sell(s.cashierGul.token, 'GUL', oneOil(s), {
      payments: [{ method: 'cash', amount: 100 }],
    });
    expect(short.body.error.code).toBe('PAYMENT_INVALID');
  });

  it('the same product twice → 400 DUPLICATE_LINE; an archived product → 400 PRODUCT_INACTIVE', async () => {
    const s = await shopWithStock(5);
    const dup = await sell(s.cashierGul.token, 'GUL', [
      { productId: s.product.id, qty: 1 },
      { productId: s.product.id, qty: 1 },
    ]);
    expect(dup.body.error.code).toBe('DUPLICATE_LINE');
    await as(s.owner.token).patch(`/api/products/${s.product.id}`).send({ isActive: false });
    const archived = await sell(s.cashierGul.token, 'GUL', oneOil(s));
    expect(archived.status).toBe(400);
    expect(archived.body.error).toMatchObject({
      code: 'PRODUCT_INACTIVE',
      details: [{ productId: s.product.id }],
    });
  });

  it('two short lines → ONE 409 listing both (the friendly pre-check)', async () => {
    const s = await shopWithStock(1);
    const cat = await makeCategory(s.owner.token);
    const tea = await makeProduct(s.owner.token, { categoryId: cat.id, name: 'Tea' }); // never stocked
    const res = await sell(s.cashierGul.token, 'GUL', [
      { productId: s.product.id, qty: 2 },
      { productId: tea.id, qty: 1 },
    ]);
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual([
      { productId: s.product.id, name: 'Soybean Oil 1L', requested: 2, available: 1 },
      { productId: tea.id, name: 'Tea', requested: 1, available: 0 },
    ]);
  });

  it('a deactivated branch can’t sell → 409 BRANCH_INACTIVE', async () => {
    const s = await shopWithStock(5);
    await as(s.owner.token).patch(`/api/branches/${s.gul._id}`).send({ isActive: false });
    const res = await sell(s.cashierGul.token, 'GUL', oneOil(s));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BRANCH_INACTIVE');
  });

  it('businessDate is the SHOP date: 23:30 in Dhaka is still that day', async () => {
    const s = await shopWithStock(5);
    // A FUTURE instant: the opening stock was recorded "now", so a past clock would put the sale's
    // movement before the stock it came from (reconciliation's newest-quantityAfter check would object).
    const ctx = await ownerCtxFor(s.gul._id, 'GUL', () => new Date('2030-10-31T17:30:00Z')); // 23:30 Dhaka
    const { sale } = await createSale(ctx, {
      clientSaleId: randomUUID(),
      lines: oneOil(s, 1),
      payments: [{ method: 'cash', amount: 100_000 }],
    });
    expect(sale.businessDate).toBe('2030-10-31'); // UTC says 31 Oct 17:30; Dhaka says 31 Oct 23:30
    expect(sale.createdAt).toBe('2030-10-31T17:30:00.000Z');
    const late = await createSale(
      await ownerCtxFor(s.gul._id, 'GUL', () => new Date('2030-10-31T18:30:00Z')),
      {
        clientSaleId: randomUUID(),
        lines: oneOil(s, 1),
        payments: [{ method: 'cash', amount: 100_000 }],
      },
    );
    expect(late.sale.businessDate).toBe('2030-11-01'); // 00:30 in Dhaka: the NEXT shop day
  });

  it('the worked example through the API matches data-model.md §12.3 (AC-PRC-03)', async () => {
    const s = await shopWithStock(0); // the test shop has 5% VAT
    const cat = await makeCategory(s.owner.token);
    const rice = await makeProduct(s.owner.token, {
      categoryId: cat.id,
      name: 'Miniket Rice 5kg',
      price: 45000,
    });
    const oil = await makeProduct(s.owner.token, {
      categoryId: cat.id,
      name: 'Soybean Oil 1L x',
      price: 18500,
    });
    const biscuits = await makeProduct(s.owner.token, { categoryId: cat.id, name: 'Biscuits', price: 2500 });
    await stockUp(s.owner.token, 'GUL', [
      { productId: rice.id, qty: 10, unitCost: 39000 },
      { productId: oil.id, qty: 10, unitCost: 16000 },
      { productId: biscuits.id, qty: 10, unitCost: 1800 },
    ]);
    const res = await sell(
      s.cashierGul.token, // a cashier: 6.88% overall is within the 10% cap
      'GUL',
      [
        { productId: rice.id, qty: 2 },
        { productId: oil.id, qty: 3, discount: { type: 'percent', bps: 500 } },
        { productId: biscuits.id, qty: 4, discount: { type: 'amount', amount: 300 } },
      ],
      {
        discount: { type: 'percent', bps: 500 },
        payments: [{ method: 'cash', amount: 155000 }],
        expectedTotal: 152044,
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.sale.totals).toEqual({
      subtotal: 155500,
      discount: 10696,
      net: 144804,
      tax: 7240,
      total: 152044,
      itemCount: 9,
    });
    expect(res.body.sale.items.map((i: { cartShare: number }) => i.cartShare)).toEqual([4500, 2636, 485]);
    expect(res.body.sale.change).toBe(2956);
  });
});

describe('POS search', () => {
  it('returns products with on-hand at THIS branch, never cost', async () => {
    const s = await shopWithStock(7);
    const res = await as(s.cashierGul.token).get('/api/b/GUL/pos/search?q=soy');
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      expect.objectContaining({ id: s.product.id, onHand: 7, price: 18500 }),
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/avgCost|unitCost/);
    const dhn = await as(s.cashierDhn.token).get('/api/b/DHN/pos/search?q=soy');
    expect(dhn.body.results[0].onHand).toBe(0); // same product, not stocked at DHN
  });
});
