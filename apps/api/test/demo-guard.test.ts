import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { User } from '../src/db/models';
import { as, makeUser, PASSWORD } from './helpers/auth';
import { makeSupplier, orderedPO, receive } from './factories/purchasing';
import { sell, shopWithStock } from './factories/sales';
import { makeShop } from './factories/shop';
import { dispatch, makeTransfer } from './factories/transfers';

const demo = async (email: string) =>
  User.updateOne({ email }, { $set: { email: email.replace('@test.dev', '@demo.shopstock.dev') } });

describe('public demo guard (DEMO_MODE)', () => {
  afterEach(() => {
    env.DEMO_MODE = false;
  });

  it('refuses password changes, logout-all and staff edits for DEMO accounts only', async () => {
    const s = await makeShop();
    await demo(s.managerGul.email);
    await demo(s.cashierGul.email);
    const other = await makeUser('cashier', [s.gul._id]); // a regular account
    env.DEMO_MODE = true;

    const ownPw = await as(s.managerGul.token)
      .patch('/api/me/password')
      .send({ currentPassword: PASSWORD, newPassword: 'Changed-123' });
    expect([ownPw.status, ownPw.body.error?.code]).toEqual([403, 'DEMO_READ_ONLY']);
    expect((await as(s.managerGul.token).post('/api/auth/logout-all')).status).toBe(403);

    const cashierId = String((await User.findOne({ email: /cashier.*@demo/ }).lean())!._id);
    expect((await as(s.owner.token).patch(`/api/staff/${cashierId}`).send({ isActive: false })).status).toBe(
      403,
    );
    expect(
      (
        await as(s.owner.token)
          .post(`/api/staff/${cashierId}/reset-password`)
          .send({ temporaryPassword: 'Temp-1234' })
      ).status,
    ).toBe(403);

    // a regular account is unaffected, and so is everything else a demo user does
    expect(
      (await as(s.owner.token).patch(`/api/staff/${other.user._id}`).send({ name: 'Renamed' })).status,
    ).toBe(200);
    expect((await as(s.managerGul.token).get('/api/b/GUL/dashboard')).status).toBe(200);
  });

  it('is off unless DEMO_MODE is set', async () => {
    const s = await makeShop();
    await demo(s.managerGul.email);
    const res = await as(s.managerGul.token)
      .patch('/api/me/password')
      .send({ currentPassword: PASSWORD, newPassword: 'Changed-123' });
    expect(res.status).toBe(200);
  });
});

describe('public demo: run the shop, but not its setup (DEMO_MODE)', () => {
  afterEach(() => {
    env.DEMO_MODE = false;
  });

  it('a demo Owner or manager is refused every setup change, with DEMO_READ_ONLY', async () => {
    const s = await shopWithStock(10);
    await demo('owner@test.dev');
    await demo(s.managerGul.email);
    const sup = await makeSupplier(s.owner.token); // made before the lock: something to try editing
    env.DEMO_MODE = true;

    const owner = as(s.owner.token);
    const manager = as(s.managerGul.token);
    const refused = [
      await owner.patch('/api/settings').send({ shopName: 'Hacked Mart' }),
      await owner.post('/api/branches').send({ code: 'BAD', name: 'Junk branch' }),
      await owner.patch(`/api/branches/${s.dhn._id}`).send({ isActive: false }),
      await owner.post('/api/staff').send({
        name: 'Junk',
        email: 'junk@x.dev',
        role: 'cashier',
        branchIds: [String(s.gul._id)],
        temporaryPassword: 'Temp-pass-123',
      }),
      await manager.post('/api/categories').send({ name: 'Junk' }),
      await manager.patch(`/api/categories/${s.product.categoryId}`).send({ name: 'Renamed' }),
      await manager
        .post('/api/products')
        .send({ sku: 'JUNK-1', name: 'Junk', categoryId: s.product.categoryId, price: 1 }),
      await manager.patch(`/api/products/${s.product.id}`).send({ isActive: false }),
      await manager.patch(`/api/products/${s.product.id}`).send({ price: 1 }),
      await manager.delete(`/api/products/${s.product.id}`),
      await manager.post('/api/suppliers').send({ name: 'Junk Ltd' }),
      await manager.patch(`/api/suppliers/${sup.id}`).send({ isActive: false }),
      await owner.patch('/api/me').send({ name: 'Someone rude' }),
    ];
    expect(refused.map((r) => [r.status, r.body.error?.code])).toEqual(
      refused.map(() => [403, 'DEMO_READ_ONLY']),
    );
    // nothing changed
    expect((await owner.get('/api/settings')).body.settings.shopName).toBe('Daily Needs Mart');
    expect((await owner.get(`/api/products/${s.product.id}`)).body.product).toMatchObject({
      isActive: true,
      price: 18500,
    });
  });

  it('…while running the shop stays open: sell, return, order and receive, transfer, adjust', async () => {
    const s = await shopWithStock(10);
    await demo(s.managerGul.email);
    await demo(s.cashierGul.email);
    const sup = await makeSupplier(s.owner.token);
    env.DEMO_MODE = true;

    const sale = await sell(s.cashierGul.token, 'GUL', [{ productId: s.product.id, qty: 2 }]);
    expect(sale.status).toBe(201);
    const manager = as(s.managerGul.token);
    const ret = await manager.post('/api/b/GUL/returns').send({
      clientReturnId: randomUUID(),
      saleId: sale.body.sale.id,
      reason: 'changed_mind',
      lines: [{ saleLineId: sale.body.sale.items[0].id, qty: 1, restock: true }],
    });
    expect(ret.status).toBe(201);
    const po = await orderedPO(s.managerGul.token, 'GUL', sup.id, [
      { productId: s.product.id, orderedQty: 5, unitCost: 100 },
    ]);
    expect(
      (await receive(s.managerGul.token, 'GUL', po.id, [{ productId: s.product.id, qty: 5 }])).status,
    ).toBe(200);
    const t = await makeTransfer(s.managerGul.token, 'GUL', 'DHN', [{ productId: s.product.id, qty: 1 }]);
    expect((await dispatch(s.managerGul.token, 'GUL', t.id)).status).toBe(200);
    const adj = await manager
      .post('/api/b/GUL/adjustments')
      .send({ reason: 'damaged', lines: [{ productId: s.product.id, qtyChange: -1 }] });
    expect(adj.status).toBe(201);
    expect((await manager.get('/api/reports/daily-sales?from=2026-10-01&to=2026-10-02')).status).toBe(200);
  });

  it('a non-demo account keeps full control in DEMO_MODE', async () => {
    const s = await makeShop();
    env.DEMO_MODE = true;
    expect((await as(s.owner.token).patch('/api/settings').send({ shopName: 'My Real Shop' })).status).toBe(
      200,
    );
    expect((await as(s.managerGul.token).post('/api/categories').send({ name: 'Real' })).status).toBe(201);
  });
});
