import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from './setup/app';
import { SETUP_BODY } from './helpers/auth';
import { Branch, Counter, Settings, User } from '../src/db/models';

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
});
