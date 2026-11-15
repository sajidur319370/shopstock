import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { User } from '../src/db/models';
import { app } from './setup/app';
import { as, setupShop } from './helpers/auth';

/** The owner from setupShop() becomes the seeded demo Owner. */
const makeDemoOwner = async () => {
  await setupShop();
  await User.updateOne({ email: 'owner@test.dev' }, { $set: { email: 'owner@demo.shopstock.dev' } });
};
const demoLogin = (account: unknown) => request(app).post('/api/auth/demo').send({ account });

describe('one-click demo login (DEMO_MODE)', () => {
  afterEach(() => {
    env.DEMO_MODE = false;
  });

  it('setup status tells the login page whether to offer it', async () => {
    expect((await request(app).get('/api/setup/status')).body.demoMode).toBe(false);
    env.DEMO_MODE = true;
    expect((await request(app).get('/api/setup/status')).body.demoMode).toBe(true);
  });

  it('logs in a seeded demo account without a password, with a refresh cookie', async () => {
    await makeDemoOwner();
    env.DEMO_MODE = true;
    const res = await demoLogin('owner');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'owner@demo.shopstock.dev', role: 'owner' });
    expect(String(res.headers['set-cookie'])).toMatch(/ss_refresh=.*HttpOnly/);
    expect((await as(res.body.accessToken).get('/api/me')).body.user.role).toBe('owner');
  });

  it("doesn't exist outside DEMO_MODE", async () => {
    await makeDemoOwner();
    const res = await demoLogin('owner');
    expect([res.status, res.body.error.code]).toEqual([404, 'NOT_FOUND']);
  });

  it('only the four demo accounts, and only once the seed created them', async () => {
    await makeDemoOwner();
    env.DEMO_MODE = true;
    expect((await demoLogin('cashier.gul')).status).toBe(404); // not seeded in this test
    expect((await demoLogin('someone.else')).body.error.code).toBe('VALIDATION_ERROR');
    expect((await request(app).post('/api/auth/demo').send({ email: 'owner@test.dev' })).status).toBe(400);
  });

  it('a deactivated demo account is refused', async () => {
    await makeDemoOwner();
    await User.updateOne({ email: 'owner@demo.shopstock.dev' }, { $set: { isActive: false } });
    env.DEMO_MODE = true;
    const res = await demoLogin('owner');
    expect([res.status, res.body.error.code]).toEqual([403, 'ACCOUNT_DISABLED']);
  });
});
