import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { as } from './helpers/auth';
import { sell, shopWithStock } from './factories/sales';
import { stockUp } from './factories/stock';
import { Inventory, Sale, StockMovement } from '../src/db/models';

/** TR-05. Race bugs hide; repetition finds them. Run once with REPEATS=20 before calling Day 11 done. */
const repeats = Number(process.env.REPEATS ?? 5);

describe('sales under concurrency', () => {
  it('10 cashiers, 3 bottles → exactly 3 sales (AC-SAL-01)', { repeats }, async () => {
    const s = await shopWithStock(3);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        sell(s.cashierGul.token, 'GUL', [{ productId: s.product.id, qty: 1 }]),
      ),
    );

    const ok = results.filter((r) => r.status === 201);
    const short = results.filter((r) => r.status === 409);
    expect(ok).toHaveLength(3);
    expect(short).toHaveLength(7);
    expect(short.every((r) => r.body.error.code === 'INSUFFICIENT_STOCK')).toBe(true);

    const inv = await Inventory.findOne({ branchId: s.gul._id }).lean();
    expect(inv!.quantity).toBe(0); // never negative
    expect(await StockMovement.countDocuments({ branchId: s.gul._id, type: 'sale' })).toBe(3);
    expect(ok.map((r) => r.body.sale.invoiceNo).sort()).toEqual(['GUL-000001', 'GUL-000002', 'GUL-000003']);
    // afterEach(expectReconciled) checks Σ movements == quantity for us
  });

  it('5 simultaneous retries of one clientSaleId → 1 sale (AC-SAL-02)', { repeats }, async () => {
    const s = await shopWithStock(10);
    const body = {
      clientSaleId: randomUUID(),
      lines: [{ productId: s.product.id, qty: 2 }],
      payments: [{ method: 'cash', amount: 100_000 }],
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => as(s.cashierGul.token).post('/api/b/GUL/sales').send(body)),
    );

    expect(results.every((r) => [200, 201].includes(r.status))).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.body.replayed === true)).toHaveLength(4);
    expect(new Set(results.map((r) => r.body.sale.invoiceNo)).size).toBe(1);
    expect(await Sale.countDocuments({ branchId: s.gul._id })).toBe(1);
    expect((await Inventory.findOne({ branchId: s.gul._id }).lean())!.quantity).toBe(8); // decremented ONCE
  });

  it('a retry AFTER the sale committed is a replay too (the network-drop case)', async () => {
    const s = await shopWithStock(10);
    const body = {
      clientSaleId: randomUUID(),
      lines: [{ productId: s.product.id, qty: 1 }],
      payments: [{ method: 'cash', amount: 100_000 }],
    };
    const first = await as(s.cashierGul.token).post('/api/b/GUL/sales').send(body);
    const retry = await as(s.cashierGul.token).post('/api/b/GUL/sales').send(body);
    expect([first.status, retry.status]).toEqual([201, 200]);
    expect(retry.body).toMatchObject({ replayed: true, sale: { invoiceNo: first.body.sale.invoiceNo } });
    expect((await Inventory.findOne({ branchId: s.gul._id }).lean())!.quantity).toBe(9);
  });

  it('50 parallel sales → invoice numbers 1..50, no gaps (AC-SAL-03)', async () => {
    const s = await shopWithStock(100);
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        sell(s.cashierGul.token, 'GUL', [{ productId: s.product.id, qty: 1 }]),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const seqs = (await Sale.find({ branchId: s.gul._id }).select('seq').lean())
      .map((x) => x.seq)
      .sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect((await Inventory.findOne({ branchId: s.gul._id }).lean())!.quantity).toBe(50);
  });

  it('two branches selling the same product never block each other (separate counters and rows)', async () => {
    const s = await shopWithStock(5);
    await stockUp(s.owner.token, 'DHN', [{ productId: s.product.id, qty: 5, unitCost: 16000 }]);
    const results = await Promise.all([
      ...Array.from({ length: 5 }, () =>
        sell(s.cashierGul.token, 'GUL', [{ productId: s.product.id, qty: 1 }]),
      ),
      ...Array.from({ length: 5 }, () =>
        sell(s.cashierDhn.token, 'DHN', [{ productId: s.product.id, qty: 1 }]),
      ),
    ]);
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.sale.invoiceNo).sort();
    expect(numbers.filter((n) => n.startsWith('DHN-'))).toHaveLength(5);
    expect(numbers.filter((n) => n.startsWith('GUL-'))).toHaveLength(5);
  });
});
