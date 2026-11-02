import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './setup/app';
import { PASSWORD, as, makeUser, refreshCookie, setupShop } from './helpers/auth';
import { Branch } from '../src/db/models';

describe('auth', () => {
  it('login → /me works and lists my branches', async () => {
    await setupShop();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'OWNER@test.dev', password: PASSWORD });
    expect(res.status).toBe(200);
    const me = await as(res.body.accessToken).get('/api/me');
    expect(me.body.user.role).toBe('owner');
    expect(me.body.branches.map((b: { code: string }) => b.code)).toEqual(['GUL']);
    expect(me.body.settings.discountCapBps).toBe(10_000);
  });

  it('wrong password and unknown email give the same error', async () => {
    await setupShop();
    const a = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@test.dev', password: 'Wrong1234' });
    const b = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.dev', password: 'Wrong1234' });
    expect(a.status).toBe(401);
    expect(a.body.error).toMatchObject({ code: b.body.error.code, message: b.body.error.message });
  });

  it('a disabled user with the right password gets 403 ACCOUNT_DISABLED', async () => {
    await setupShop();
    const gul = await Branch.findOne({ code: 'GUL' }).lean();
    const { res } = await makeUser('cashier', [gul!._id], { isActive: false });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('refresh rotates; replaying the old token revokes the family (AC-AUTH-02)', async () => {
    await setupShop();
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/login').send({ email: 'owner@test.dev', password: PASSWORD });
    const oldCookie = refreshCookie(login);

    const r1 = await agent.post('/api/auth/refresh');
    expect(r1.status).toBe(200);
    expect(refreshCookie(r1)).not.toBe(oldCookie);

    const replay = await request(app).post('/api/auth/refresh').set('Cookie', oldCookie);
    expect(replay.body.error.code).toBe('SESSION_REVOKED');
    expect((await agent.post('/api/auth/refresh')).status).toBe(401); // the new session died too
  });

  it('logout revokes the refresh token', async () => {
    await setupShop();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email: 'owner@test.dev', password: PASSWORD });
    expect((await agent.post('/api/auth/logout')).status).toBe(204);
    expect((await agent.post('/api/auth/refresh')).status).toBe(401);
  });

  it('change password clears mustChangePassword and revokes OTHER sessions', async () => {
    await setupShop();
    const gul = await Branch.findOne({ code: 'GUL' }).lean();
    const { email, token } = await makeUser('cashier', [gul!._id], { mustChangePassword: true });
    const otherDevice = request.agent(app);
    await otherDevice.post('/api/auth/login').send({ email, password: PASSWORD });

    const res = await as(token)
      .patch('/api/me/password')
      .send({ currentPassword: PASSWORD, newPassword: 'NewPassw0rd' });
    expect(res.status).toBe(200);
    expect((await as(token).get('/api/me')).body.user.mustChangePassword).toBe(false);
    expect((await otherDevice.post('/api/auth/refresh')).status).toBe(401);
  });

  it('never leaks hashes or tokens in responses (AC-AUTH-05)', async () => {
    const { token } = await setupShop();
    const json = JSON.stringify((await as(token).get('/api/me')).body);
    expect(json).not.toContain('passwordHash');
    expect(json).not.toMatch(/\$2[aby]\$/); // bcrypt prefix
  });
});
