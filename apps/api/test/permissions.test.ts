import { describe, expect, it } from 'vitest';
import { assignableRoles, can } from '@shopstock/shared';

describe('permissions', () => {
  it.each([
    ['cashier', 'sale:create', true],
    ['cashier', 'sale:viewAll', false],
    ['cashier', 'inventory:viewCost', false],
    ['cashier', 'return:create', false],
    ['manager', 'return:create', true],
    ['manager', 'branch:manage', false],
    ['manager', 'report:view', true],
    ['owner', 'settings:update', true],
    ['owner', 'reconcile:run', true],
  ] as const)('%s → %s = %s', (role, perm, expected) => expect(can(role, perm)).toBe(expected));

  it('no role → nothing', () => {
    expect(can(null, 'sale:view')).toBe(false);
    expect(can(undefined, 'dashboard:view')).toBe(false);
  });

  it('assignable roles', () => {
    expect(assignableRoles('owner')).toEqual(['manager', 'cashier']);
    expect(assignableRoles('manager')).toEqual(['cashier']);
    expect(assignableRoles('cashier')).toEqual([]);
  });
});
