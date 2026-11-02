import type { Permission } from '@shopstock/shared';

export type NavItem = {
  label: string;
  to: (code: string) => string;
  permission: Permission;
  scope: 'branch' | 'shop';
};

/** One list, filtered by permission. Branch items get the current branch code. */
export const NAV: NavItem[] = [
  { label: 'POS', to: (c) => `/b/${c}/pos`, permission: 'sale:create', scope: 'branch' },
  { label: 'Dashboard', to: (c) => `/b/${c}/dashboard`, permission: 'dashboard:view', scope: 'branch' },
  { label: 'Sales', to: (c) => `/b/${c}/sales`, permission: 'sale:view', scope: 'branch' },
  { label: 'Returns', to: (c) => `/b/${c}/returns`, permission: 'return:view', scope: 'branch' },
  { label: 'Inventory', to: (c) => `/b/${c}/inventory`, permission: 'inventory:view', scope: 'branch' },
  { label: 'Purchase orders', to: (c) => `/b/${c}/purchase-orders`, permission: 'po:view', scope: 'branch' },
  { label: 'Transfers', to: (c) => `/b/${c}/transfers`, permission: 'transfer:view', scope: 'branch' },
  { label: 'Products', to: () => '/catalog/products', permission: 'catalog:manage', scope: 'shop' },
  { label: 'Suppliers', to: () => '/suppliers', permission: 'supplier:view', scope: 'shop' },
  { label: 'Reports', to: () => '/reports', permission: 'report:view', scope: 'shop' },
  { label: 'Staff', to: () => '/admin/staff', permission: 'staff:view', scope: 'shop' },
  { label: 'Branches', to: () => '/admin/branches', permission: 'branch:manage', scope: 'shop' },
  { label: 'Settings', to: () => '/admin/settings', permission: 'settings:update', scope: 'shop' },
];

/** Where a role lands in a branch: cashiers at the counter, everyone else on the dashboard. */
export const branchHome = (role: string, code: string) =>
  role === 'cashier' ? `/b/${code}/pos` : `/b/${code}/dashboard`;
