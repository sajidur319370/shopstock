import { expect, test } from '@playwright/test';
import { api, loginUI, makeStaff, OWNER, PW } from './helpers';

/** TR-09: the four journeys, in order, on one fresh shop (the first one creates it). */
test.describe.configure({ mode: 'serial' });

const CASHIER = 'rafi@e2e.dev';
const MANAGER = 'mina@e2e.dev';
const PRODUCTS = [
  { sku: 'OIL-SOY-1L', name: 'Soybean Oil 1L', barcode: '8941100500017', price: 18500 },
  { sku: 'RICE-5KG', name: 'Miniket Rice 5kg', barcode: '8941100100011', price: 45000 },
  { sku: 'SALT-1KG', name: 'Iodized Salt 1kg', barcode: '8941100200018', price: 4200 },
];
const OPENING = 20;
const shop = { gulId: '', productIds: [] as string[] };

test('setup wizard: a fresh shop, then logged in', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup/);
  await page.getByLabel('Shop name').fill('E2E Mart');
  await page.getByLabel('Timezone').fill('Asia/Dhaka');
  await page.getByLabel('VAT rate').fill('5');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Your name').fill('Owner');
  await page.getByLabel('Email').fill(OWNER);
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Branch code').fill('GUL');
  await page.getByLabel('Branch name').fill('Gulshan');
  await page.getByRole('button', { name: 'Create shop' }).click();
  await expect(page.getByRole('heading', { name: /overview|dashboard/i })).toBeVisible();
});

test('cashier sells 3 items by keyboard and the receipt renders', async ({ page, request }) => {
  // Arrange through the API: products with barcodes, opening stock, a cashier.
  const owner = await api(request, OWNER);
  const { branches } = await (await owner.get('/branches')).json();
  shop.gulId = branches[0].id;
  const { category } = await owner.post('/categories', { name: 'Groceries' });
  for (const p of PRODUCTS) {
    shop.productIds.push((await owner.post('/products', { ...p, categoryId: category.id })).product.id);
  }
  await owner.post('/b/GUL/adjustments', {
    reason: 'opening_balance',
    lines: shop.productIds.map((productId) => ({ productId, qtyChange: OPENING, unitCost: 1000 })),
  });
  await makeStaff(request, owner, { name: 'Rafi', email: CASHIER, role: 'cashier', branchIds: [shop.gulId] });

  await page.addInitScript(() => {
    window.print = () => {}; // no print dialog in headless runs
  });
  await loginUI(page, CASHIER);
  await expect(page).toHaveURL(/\/b\/GUL\/pos/);

  const search = page.getByRole('textbox', { name: 'Scan or search products' });
  await expect(search).toBeFocused(); // focus discipline (Day 12): a scanner works at once
  for (const p of PRODUCTS) {
    await page.keyboard.type(p.barcode);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('row', { name: new RegExp(p.name) })).toBeVisible();
  }
  await expect(page.getByRole('row')).toHaveCount(1 + 3); // header + 3 lines
  await page.keyboard.press('F9');
  await expect(page.getByLabel('Cash received')).toBeFocused();
  await page.keyboard.type('1000');
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/sales\/.+\/print/);
  await expect(page.getByText('GUL-000001')).toBeVisible();
  await expect(page.getByText(/TOTAL/)).toBeVisible();
});

test('manager receives a PO and stock rises', async ({ page, request }) => {
  const owner = await api(request, OWNER);
  await makeStaff(request, owner, { name: 'Mina', email: MANAGER, role: 'manager', branchIds: [shop.gulId] });
  const { supplier } = await owner.post('/suppliers', { name: 'Fresh Foods Ltd' });
  const productId = shop.productIds[2]!; // salt: 20 opening − 1 sold
  const { purchaseOrder: po } = await owner.post('/b/GUL/purchase-orders', {
    supplierId: supplier.id,
    lines: [{ productId, orderedQty: 10, unitCost: 3000 }],
  });
  await owner.post(`/b/GUL/purchase-orders/${po.id}/order`);

  await loginUI(page, MANAGER);
  await expect(page).toHaveURL(/\/b\/GUL\//);
  await page.goto(`/b/GUL/purchase-orders/${po.id}`);
  await page.getByRole('link', { name: 'Receive delivery' }).click();
  await page.getByRole('button', { name: 'Confirm receipt' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Receive' }).click();
  await expect(page.getByText('Received', { exact: true }).first()).toBeVisible();

  await page.goto('/b/GUL/inventory');
  await expect(page.getByRole('row', { name: /Iodized Salt 1kg/ })).toContainText(String(OPENING - 1 + 10));
});

test('a cashier cannot open reports', async ({ page, request }) => {
  await loginUI(page, CASHIER);
  await expect(page).toHaveURL(/\/b\/GUL\/pos/);
  await expect(page.getByRole('link', { name: 'Reports' })).toHaveCount(0);
  await page.goto('/reports');
  await expect(page.getByText(/don't have access/i)).toBeVisible();
  const cashier = await api(request, CASHIER);
  expect((await cashier.get('/reports/daily-sales?from=2026-10-01&to=2026-10-02')).status()).toBe(403);
});
