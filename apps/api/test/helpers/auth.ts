import request, { type Response } from 'supertest';
import type { Types } from 'mongoose';
import type { Role } from '@shopstock/shared';
import { app } from '../setup/app';
import { User } from '../../src/db/models';
import { hashPassword } from '../../src/lib/password';

export const PASSWORD = 'Passw0rd!';

export const SETUP_BODY = {
  shopName: 'Daily Needs Mart',
  currency: { code: 'BDT', symbol: '৳', minorUnits: 2 },
  timezone: 'Asia/Dhaka',
  taxRateBps: 500,
  owner: { name: 'Karim Owner', email: 'owner@test.dev', password: PASSWORD },
  branch: { code: 'GUL', name: 'Gulshan' },
};

/** Runs setup and returns the Owner's token. */
export async function setupShop(body = SETUP_BODY) {
  const res = await request(app).post('/api/setup').send(body);
  if (res.status !== 201) throw new Error(`setup failed: ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken as string, user: res.body.user };
}

let n = 0;
/** Inserts a user directly (the staff API arrives on Day 5) and logs them in. */
export async function makeUser(
  role: Exclude<Role, 'owner'>,
  branchIds: Types.ObjectId[],
  extra: Partial<{ mustChangePassword: boolean; isActive: boolean }> = {},
) {
  const email = `${role}${++n}@test.dev`;
  const user = await User.create({
    email,
    name: `${role} ${n}`,
    role,
    branchIds,
    passwordHash: await hashPassword(PASSWORD),
    ...extra,
  });
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return { user, email, token: res.body.accessToken as string, res };
}

export function refreshCookie(res: Response): string {
  const raw = res.get('Set-Cookie') ?? [];
  const c = raw.find((x) => x.startsWith('ss_refresh='));
  if (!c) throw new Error('no refresh cookie');
  return c.split(';')[0]!;
}

/** Supertest with the Authorization header already set. */
export const as = (token: string) => ({
  get: (p: string) => request(app).get(p).set('Authorization', `Bearer ${token}`),
  post: (p: string) => request(app).post(p).set('Authorization', `Bearer ${token}`),
  patch: (p: string) => request(app).patch(p).set('Authorization', `Bearer ${token}`),
  put: (p: string) => request(app).put(p).set('Authorization', `Bearer ${token}`),
  delete: (p: string) => request(app).delete(p).set('Authorization', `Bearer ${token}`),
});
