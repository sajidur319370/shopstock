import { describe, expect, it } from 'vitest';
import type { SupplierDetailDto, SupplierDto } from '@shopstock/shared';
import { as } from './helpers/auth';
import { makeShop } from './factories/shop';
import { makeCategory, makeProduct } from './factories/catalog';
import { makeSupplier, orderedPO, receive } from './factories/purchasing';

const names = (items: SupplierDto[]) => items.map((s) => s.name);

describe('suppliers (FR-SUP-01..03)', () => {
  it('create, list A→Z with prefix search; a name is unique ignoring case', async () => {
    const s = await makeShop();
    const created = await as(s.managerGul.token).post('/api/suppliers').send({
      name: 'Meghna Distributors',
      contactName: 'Rahim',
      phone: '01711-000000',
      email: 'SALES@Meghna.test',
    });
    expect(created.status).toBe(201);
    expect(created.body.supplier).toMatchObject({
      name: 'Meghna Distributors',
      email: 'sales@meghna.test',
      address: '',
      isActive: true,
    });
    await makeSupplier(s.owner.token, 'ACI Foods');
    await makeSupplier(s.owner.token, 'Square Toiletries');

    expect(names((await as(s.managerGul.token).get('/api/suppliers')).body.items)).toEqual([
      'ACI Foods',
      'Meghna Distributors',
      'Square Toiletries',
    ]);
    expect(names((await as(s.managerGul.token).get('/api/suppliers?q=MEG')).body.items)).toEqual([
      'Meghna Distributors',
    ]);
    const dup = await as(s.managerGul.token).post('/api/suppliers').send({ name: 'meghna distributors' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SUPPLIER_TAKEN');
    expect((await as(s.managerGul.token).post('/api/suppliers').send({ name: 'X' })).status).toBe(400);
  });

  it('a PATCH changes only what it sends (the other fields are not blanked)', async () => {
    const s = await makeShop();
    const sup = (
      await as(s.owner.token)
        .post('/api/suppliers')
        .send({ name: 'Meghna', contactName: 'Rahim', phone: '017', address: 'Tejgaon', notes: 'Net 30' })
    ).body.supplier as SupplierDto;
    const res = await as(s.managerGul.token).patch(`/api/suppliers/${sup.id}`).send({ phone: '018' });
    expect(res.status).toBe(200);
    expect(res.body.supplier).toEqual({ ...sup, phone: '018' });
    expect((await as(s.managerGul.token).patch(`/api/suppliers/${sup.id}`).send({})).status).toBe(400);
  });

  it('a rename is searchable and still unique', async () => {
    const s = await makeShop();
    const a = await makeSupplier(s.owner.token, 'Old Name');
    await makeSupplier(s.owner.token, 'Taken');
    await as(s.owner.token).patch(`/api/suppliers/${a.id}`).send({ name: 'New Name' });
    expect(names((await as(s.owner.token).get('/api/suppliers?q=new')).body.items)).toEqual(['New Name']);
    const clash = await as(s.owner.token).patch(`/api/suppliers/${a.id}`).send({ name: 'TAKEN' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('SUPPLIER_TAKEN');
  });

  it('deactivated: hidden by default, no NEW POs, but an existing PO carries on (FR-SUP-02)', async () => {
    const s = await makeShop();
    const cat = await makeCategory(s.owner.token);
    const p = await makeProduct(s.owner.token, { categoryId: cat.id });
    const sup = await makeSupplier(s.owner.token, 'Leaving Ltd');
    const open = await orderedPO(s.managerGul.token, 'GUL', sup.id, [
      { productId: p.id, orderedQty: 2, unitCost: 10 },
    ]);

    await as(s.owner.token).patch(`/api/suppliers/${sup.id}`).send({ isActive: false });
    expect(names((await as(s.owner.token).get('/api/suppliers')).body.items)).toEqual([]);
    expect(names((await as(s.owner.token).get('/api/suppliers?active=false')).body.items)).toEqual([
      'Leaving Ltd',
    ]);
    expect(names((await as(s.owner.token).get('/api/suppliers?active=all')).body.items)).toEqual([
      'Leaving Ltd',
    ]);

    const fresh = await as(s.managerGul.token)
      .post('/api/b/GUL/purchase-orders')
      .send({ supplierId: sup.id, lines: [{ productId: p.id, orderedQty: 1, unitCost: 1 }] });
    expect(fresh.body.error.code).toBe('INVALID_SUPPLIER');
    expect((await receive(s.managerGul.token, 'GUL', open.id, [{ productId: p.id, qty: 2 }])).status).toBe(
      200,
    );
  });

  it("detail shows recent POs of the ACTOR's branches only", async () => {
    const s = await makeShop();
    const cat = await makeCategory(s.owner.token);
    const p = await makeProduct(s.owner.token, { categoryId: cat.id });
    const sup = await makeSupplier(s.owner.token);
    const line = [{ productId: p.id, orderedQty: 1, unitCost: 1 }];
    const gulPo = await orderedPO(s.owner.token, 'GUL', sup.id, line);
    const dhnPo = await orderedPO(s.owner.token, 'DHN', sup.id, line);

    const mine = (await as(s.managerGul.token).get(`/api/suppliers/${sup.id}`)).body as SupplierDetailDto;
    expect(mine.supplier.id).toBe(sup.id);
    expect(mine.recentPOs.map((r) => [r.poNumber, r.branchCode])).toEqual([[gulPo.poNumber, 'GUL']]);
    const all = (await as(s.owner.token).get(`/api/suppliers/${sup.id}`)).body as SupplierDetailDto;
    expect(all.recentPOs.map((r) => r.poNumber)).toEqual([dhnPo.poNumber, gulPo.poNumber]);
    expect((await as(s.owner.token).get('/api/suppliers/0123456789abcdef01234567')).status).toBe(404);
  });

  it('cashiers can neither see nor manage suppliers', async () => {
    const s = await makeShop();
    expect((await as(s.cashierGul.token).get('/api/suppliers')).status).toBe(403);
    expect((await as(s.cashierGul.token).post('/api/suppliers').send({ name: 'Nope' })).status).toBe(403);
  });
});
