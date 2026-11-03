import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { loginUI } from './helpers';

/**
 * TR-11: no WCAG 2 A/AA violations axe can detect on the busiest screens. Runs after the journeys
 * (same database): the manager and the shop exist.
 */
for (const path of ['/b/GUL/pos', '/b/GUL/inventory', '/b/GUL/dashboard', '/reports']) {
  test(`a11y: ${path}`, async ({ page }) => {
    await loginUI(page, 'mina@e2e.dev');
    await expect(page).toHaveURL(/\/b\/GUL\//);
    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible();
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    // Each violation with its first nodes: the selector and axe's explanation (e.g. the contrast ratio).
    expect(
      results.violations.map(
        (v) =>
          `${v.id} (${v.nodes.length}): ` +
          v.nodes
            .slice(0, 3)
            .map((n) => `${n.target.join(' ')} → ${n.failureSummary?.split('\n').at(-1)?.trim()}`)
            .join(' | '),
      ),
    ).toEqual([]);
  });
}
