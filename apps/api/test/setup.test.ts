import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { app } from './setup/app';
import { SETUP_BODY } from './helpers/auth';
import { Branch, Counter, Settings, User } from '../src/db/models';
import { env } from '../src/config/env';

describe('setup', () => {
  it('status → needsSetup until done', async () => {
    expect((await request(app).get('/api/setup/status')).body.needsSetup).toBe(true);
    await request(app).post('/api/setup').send(SETUP_BODY);
    expect((await request(app).get('/api/setup/status')).body.needsSetup).toBe(false);
  });

  it('creates settings, owner, branch and 3 counters in one go', async () => {
    const res = await request(app).post('/api/setup').send(SETUP_BODY);
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('owner');
    expect(await Settings.countDocuments()).toBe(1);
    const branch = await Branch.findOne({ code: 'GUL' }).lean();
    expect(await Counter.countDocuments({ _id: { $regex: String(branch!._id) } })).toBe(3);
  });

  it('two parallel setups → exactly one shop (AC-AUTH-01)', async () => {
    const other = {
      ...SETUP_BODY,
      owner: { ...SETUP_BODY.owner, email: 'other@test.dev' },
      branch: { code: 'DHN', name: 'Dhanmondi' },
    };
    const [a, b] = await Promise.all([
      request(app).post('/api/setup').send(SETUP_BODY),
      request(app).post('/api/setup').send(other),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a, b].find((r) => r.status === 409)!.body.error.code).toBe('ALREADY_SET_UP');
    expect(await User.countDocuments({ role: 'owner' })).toBe(1);
    expect(await Branch.countDocuments()).toBe(1);
  });

  it('branch code is uppercased', async () => {
    await request(app)
      .post('/api/setup')
      .send({ ...SETUP_BODY, branch: { code: 'gul', name: 'Gulshan' } });
    expect(await Branch.exists({ code: 'GUL' })).toBeTruthy();
  });

  describe('SETUP_TOKEN (production: a fresh public deploy can only be claimed with the token)', () => {
    const TOKEN = 'a-long-random-setup-token';
    afterEach(() => {
      env.SETUP_TOKEN = undefined;
    });

    it('without SETUP_TOKEN no header is needed (dev, tests)', async () => {
      expect((await request(app).get('/api/setup/status')).body).toEqual({
        needsSetup: true,
        tokenRequired: false,
      });
    });

    it('with SETUP_TOKEN: missing or wrong header → 403, nothing created; the right one → 201', async () => {
      env.SETUP_TOKEN = TOKEN;
      expect((await request(app).get('/api/setup/status')).body.tokenRequired).toBe(true);

      const none = await request(app).post('/api/setup').send(SETUP_BODY);
      expect(none.status).toBe(403);
      expect(none.body.error.code).toBe('SETUP_TOKEN_REQUIRED');
      const wrong = await request(app).post('/api/setup').set('x-setup-token', 'nope').send(SETUP_BODY);
      expect(wrong.status).toBe(403);
      expect(await Settings.countDocuments()).toBe(0);

      const ok = await request(app).post('/api/setup').set('x-setup-token', TOKEN).send(SETUP_BODY);
      expect(ok.status).toBe(201);
    });
  });
});
