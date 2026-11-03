import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const PW = 'Demo-pass-123';
export const OWNER = 'owner@e2e.dev';

/** An API client for ARRANGING data quickly: the UI is what's under test, not the arrangement. */
export async function api(request: APIRequestContext, email: string, password = PW) {
  const login = await request.post('/api/auth/login', { data: { email, password } });
  expect(login.ok(), `login ${email}`).toBe(true);
  const { accessToken } = await login.json();
  const headers = { authorization: `Bearer ${accessToken}` };
  return {
    post: async (p: string, data: object = {}) => {
      const res = await request.post(`/api${p}`, { data, headers });
      expect(res.ok(), `POST ${p}: ${res.status()} ${await res.text()}`).toBe(true);
      return res.status() === 204 ? null : res.json();
    },
    patch: async (p: string, data: object) => {
      const res = await request.patch(`/api${p}`, { data, headers });
      expect(res.ok(), `PATCH ${p}: ${res.status()}`).toBe(true);
      return res.json();
    },
    get: (p: string) => request.get(`/api${p}`, { headers }),
  };
}
export type Api = Awaited<ReturnType<typeof api>>;

export async function loginUI(page: Page, email: string, password = PW) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
}

/** A staff member whose temporary password is already changed (forced change is its own feature). */
export async function makeStaff(
  request: APIRequestContext,
  owner: Api,
  s: { name: string; email: string; role: 'manager' | 'cashier'; branchIds: string[] },
) {
  await owner.post('/staff', { ...s, temporaryPassword: 'Temp-pass-123' });
  const me = await api(request, s.email, 'Temp-pass-123');
  await me.patch('/me/password', { currentPassword: 'Temp-pass-123', newPassword: PW });
  return { email: s.email };
}
