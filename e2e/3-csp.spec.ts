import { expect, test } from '@playwright/test';
import { api, loginUI, OWNER } from './helpers';

/**
 * NFR-SEC: the strict CSP (script-src 'self') must not break any screen: no "Refused to …" on the POS,
 * a receipt (its @page <style>), the reports (Recharts) or the dashboard. Headers present in production.
 */
test('CSP and HSTS headers are sent, and no screen trips the policy', async ({ page, request }) => {
  const home = await request.get('/');
  const csp = home.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(home.headers()['strict-transport-security']).toContain('max-age=15552000');

  const refused: string[] = [];
  page.on('console', (m) => /Content Security Policy|Refused to/i.test(m.text()) && refused.push(m.text()));
  await page.addInitScript(() => {
    window.print = () => {};
  });
  const owner = await api(request, OWNER);
  const { items } = await (await owner.get('/b/GUL/sales')).json();

  await loginUI(page, 'mina@e2e.dev');
  await expect(page).toHaveURL(/\/b\/GUL\//);
  for (const path of ['/b/GUL/pos', `/b/GUL/sales/${items[0].id}/print`, '/b/GUL/dashboard', '/reports']) {
    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible();
    await page.waitForLoadState('networkidle');
  }
  await expect(page.locator('.recharts-surface').first()).toBeVisible(); // the charts really rendered
  expect(refused).toEqual([]);
});
