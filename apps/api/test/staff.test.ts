import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from './setup/app';
import { PASSWORD, as, refreshCookie } from './helpers/auth';
import { makeShop, type Shop } from './factories/shop';
import { Session, User } from '../src/db/models';

const newStaff = (
  role: 'manager' | 'cashier',
  branchIds: string[],
  email = `s${Math.random()}@test.dev`,
) => ({
  name: 'New Person',
  email,
  role,
  branchIds,
  temporaryPassword: 'Temp1234',
});

describe('staff API & role ceiling', () => {
  let s: Shop;
  let GUL: string;
  let DHN: string;
  beforeEach(async () => {
    s = await makeShop();
    GUL = String(s.gul._id);
    DHN = String(s.dhn._id);
  });

  it('Owner creates a GUL+DHN manager → must change password before any other route', async () => {
    const res = await as(s.owner.token)
      .post('/api/staff')
      .send(newStaff('manager', [GUL, DHN], 'mina@test.dev'));
    expect(res.status).toBe(201);
    expect(res.body.staff).toMatchObject({ role: 'manager', mustChangePassword: true, isActive: true });
    expect(res.body.staff.branchIds).toEqual([GUL, DHN]);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[aby]\$/);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'mina@test.dev', password: 'Temp1234' });
    expect(login.body.user.mustChangePassword).toBe(true);
    const branch = await as(login.body.accessToken).get('/api/b/GUL');
    expect(branch.status).toBe(403);
    expect(branch.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await as(login.body.accessToken).get('/api/me')).status).toBe(200); // /me stays reachable
  });

  it('AC-USR-01: a GUL manager may only create GUL cashiers', async () => {
    const m = as(s.managerGul.token);
    expect((await m.post('/api/staff').send(newStaff('cashier', [DHN]))).status).toBe(403);
    expect((await m.post('/api/staff').send(newStaff('manager', [GUL]))).status).toBe(403);
    expect((await m.post('/api/staff').send(newStaff('cashier', [GUL]))).status).toBe(201);
  });

  it('AC-USR-02: a manager cannot touch the Owner or another branch’s staff (not even see them)', async () => {
    const m = as(s.managerGul.token);
    expect((await m.patch(`/api/staff/${s.owner.user.id}`).send({ isActive: false })).status).toBe(404);
    expect((await m.patch(`/api/staff/${s.managerDhn.user._id}`).send({ isActive: false })).status).toBe(404);
    expect((await m.patch(`/api/staff/${s.cashierDhn.user._id}`).send({ name: 'X' })).status).toBe(404);
    expect(await User.countDocuments({ isActive: false })).toBe(0);
  });

  it('nobody changes their own access; nobody edits the Owner', async () => {
    const self = await as(s.managerGul.token)
      .patch(`/api/staff/${s.managerGul.user._id}`)
      .send({ name: 'Me' });
    expect(self.status).toBe(403);
    const ownerSelf = await as(s.owner.token).patch(`/api/staff/${s.owner.user.id}`).send({ name: 'Boss' });
    expect(ownerSelf.status).toBe(403);
  });

  it('a manager lists only staff of their branches', async () => {
    const res = await as(s.managerGul.token).get('/api/staff');
    const emails = res.body.staff.map((u: { email: string }) => u.email).sort();
    expect(emails).toEqual([s.cashierGul.email, s.managerGul.email].sort());
    expect((await as(s.cashierGul.token).get('/api/staff')).status).toBe(403);
  });

  it('a cashier works at exactly one branch → 400 INVALID_BRANCHES', async () => {
    const res = await as(s.owner.token)
      .post('/api/staff')
      .send(newStaff('cashier', [GUL, DHN]));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_BRANCHES');
  });

  it('duplicate email → 409 EMAIL_TAKEN (case-insensitive)', async () => {
    const res = await as(s.owner.token)
      .post('/api/staff')
      .send(newStaff('cashier', [GUL], s.cashierGul.email.toUpperCase()));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('AC-AUTH-03: deactivating a cashier locks them out on their NEXT request, refresh included', async () => {
    const oldCookie = refreshCookie(s.cashierGul.res);
    expect((await as(s.cashierGul.token).get('/api/b/GUL')).status).toBe(200);

    const off = await as(s.managerGul.token)
      .patch(`/api/staff/${s.cashierGul.user._id}`)
      .send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.staff.isActive).toBe(false);

    const next = await as(s.cashierGul.token).get('/api/b/GUL'); // the access token itself is still unexpired
    expect(next.status).toBe(401);
    expect(next.body.error.code).toBe('ACCOUNT_DISABLED');
    expect((await request(app).post('/api/auth/refresh').set('Cookie', oldCookie)).status).toBe(401);
    expect(await Session.countDocuments({ userId: s.cashierGul.user._id, revokedAt: null })).toBe(0);
  });

  it('AC-SCOPE-03: reassigning a manager GUL → DHN takes effect on the next request', async () => {
    const res = await as(s.owner.token)
      .patch(`/api/staff/${s.managerGul.user._id}`)
      .send({ branchIds: [DHN] });
    expect(res.status).toBe(200);
    expect((await as(s.managerGul.token).get('/api/b/GUL')).status).toBe(404);
    expect((await as(s.managerGul.token).get('/api/b/DHN')).status).toBe(200);
  });

  it('reset password: temporary password works, must change it, other sessions revoked', async () => {
    const res = await as(s.managerGul.token)
      .post(`/api/staff/${s.cashierGul.user._id}/reset-password`)
      .send({ temporaryPassword: 'Reset1234' });
    expect(res.status).toBe(204);
    expect((await as(s.cashierGul.token).get('/api/b/GUL')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    const old = await request(app)
      .post('/api/auth/login')
      .send({ email: s.cashierGul.email, password: PASSWORD });
    expect(old.status).toBe(401);
    const fresh = await request(app)
      .post('/api/auth/login')
      .send({ email: s.cashierGul.email, password: 'Reset1234' });
    expect(fresh.status).toBe(200);
    expect(fresh.body.user.mustChangePassword).toBe(true);
  });
});
