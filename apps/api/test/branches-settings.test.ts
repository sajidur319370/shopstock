import { beforeEach, describe, expect, it } from 'vitest';
import { as } from './helpers/auth';
import { makeShop, type Shop } from './factories/shop';
import { Branch, Counter, Settings } from '../src/db/models';

describe('branches & settings', () => {
  let s: Shop;
  beforeEach(async () => {
    s = await makeShop();
  });

  it('creating a branch creates its 3 counters in the same transaction', async () => {
    const res = await as(s.owner.token).post('/api/branches').send({ code: 'utt', name: 'Uttara' });
    expect(res.status).toBe(201);
    expect(res.body.branch).toMatchObject({ code: 'UTT', name: 'Uttara', isActive: true });
    const utt = await Branch.findOne({ code: 'UTT' }).lean();
    const keys = (await Counter.find({ _id: { $regex: String(utt!._id) } }).lean()).map((c) => c._id).sort();
    expect(keys).toEqual([`adj:${utt!._id}`, `return:${utt!._id}`, `sale:${utt!._id}`]);
  });

  it('duplicate branch code → 409 BRANCH_CODE_TAKEN, and no orphan counters', async () => {
    const before = await Counter.countDocuments();
    const res = await as(s.owner.token).post('/api/branches').send({ code: 'GUL', name: 'Again' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BRANCH_CODE_TAKEN');
    expect(await Counter.countDocuments()).toBe(before);
  });

  it('a new branch shows up for the Owner immediately (cache invalidated)', async () => {
    await as(s.owner.token).post('/api/branches').send({ code: 'UTT', name: 'Uttara' });
    const me = await as(s.owner.token).get('/api/me');
    expect(me.body.branches.map((b: { code: string }) => b.code)).toEqual(['DHN', 'GUL', 'UTT']);
  });

  it('GET /branches lists only the branches I may access', async () => {
    const res = await as(s.cashierGul.token).get('/api/branches');
    expect(res.body.branches.map((b: { code: string }) => b.code)).toEqual(['GUL']);
  });

  it('inactive branch: staff get 409 BRANCH_INACTIVE; the Owner may still read it', async () => {
    const off = await as(s.owner.token).patch(`/api/branches/${s.dhn._id}`).send({ isActive: false });
    expect(off.status).toBe(200);
    const cashier = await as(s.cashierDhn.token).get('/api/b/DHN');
    expect(cashier.status).toBe(409);
    expect(cashier.body.error.code).toBe('BRANCH_INACTIVE');
    expect((await as(s.owner.token).get('/api/b/DHN')).status).toBe(200);
  });

  it('branch code can’t be changed (not in the update schema) and a bad :id → 400', async () => {
    const res = await as(s.owner.token).patch(`/api/branches/${s.dhn._id}`).send({ code: 'XYZ' });
    expect(res.status).toBe(400); // `code` is stripped → "Nothing to update"
    expect((await as(s.owner.token).patch('/api/branches/not-an-id').send({ name: 'Xx' })).status).toBe(400);
  });

  it('PATCH settings with ONE nested cap leaves the other cap alone (flattenForSet)', async () => {
    const res = await as(s.owner.token)
      .patch('/api/settings')
      .send({ discountCapsBps: { cashier: 500 } });
    expect(res.status).toBe(200);
    const doc = await Settings.findById('shop').lean();
    expect(doc!.discountCapsBps).toEqual({ cashier: 500, manager: 3000 });
    const me = await as(s.cashierGul.token).get('/api/me');
    expect(me.body.settings.discountCapBps).toBe(500); // the cashier sees the new cap at once
  });

  it('currency can’t be changed after setup', async () => {
    const res = await as(s.owner.token)
      .patch('/api/settings')
      .send({ currency: { code: 'USD' } });
    expect(res.status).toBe(400); // stripped → "Nothing to update"
    expect((await Settings.findById('shop').lean())!.currency!.code).toBe('BDT');
  });
});
