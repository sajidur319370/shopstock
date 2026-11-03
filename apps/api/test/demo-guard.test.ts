import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { User } from '../src/db/models';
import { as, makeUser, PASSWORD } from './helpers/auth';
import { makeShop } from './factories/shop';

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
