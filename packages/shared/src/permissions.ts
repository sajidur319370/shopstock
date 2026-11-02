import { ROLE_LEVEL, type Role } from './constants';

/** Minimum role per permission. ◐ rules (own sales only, role ceiling) are checked in services. */
export const PERMISSIONS = {
  'settings:view': 'cashier',
  'settings:update': 'owner',
  'branch:view': 'cashier',
  'branch:manage': 'owner',
  'staff:view': 'manager',
  'staff:manage': 'manager',
  'catalog:view': 'cashier',
  'catalog:manage': 'manager',
  'supplier:view': 'manager',
  'supplier:manage': 'manager',
  'inventory:view': 'cashier',
  'inventory:viewCost': 'manager',
  'inventory:adjust': 'manager',
  'inventory:configure': 'manager',
  'movement:view': 'manager',
  'sale:create': 'cashier',
  'sale:view': 'cashier',
  'sale:viewAll': 'manager',
  'invoice:print': 'cashier',
  'return:create': 'manager',
  'return:view': 'manager',
  'po:view': 'manager',
  'po:manage': 'manager',
  'po:receive': 'manager',
  'transfer:view': 'manager',
  'transfer:manage': 'manager',
  'dashboard:view': 'cashier',
  'report:view': 'manager',
  'reconcile:run': 'owner',
} as const satisfies Record<string, Role>;

export type Permission = keyof typeof PERMISSIONS;

export const can = (role: Role | null | undefined, permission: Permission): boolean =>
  !!role && ROLE_LEVEL[role] >= ROLE_LEVEL[PERMISSIONS[permission]];

/** FR-USR-02: the roles an actor may create or assign. */
export const assignableRoles = (actor: Role): ('manager' | 'cashier')[] =>
  actor === 'owner' ? ['manager', 'cashier'] : actor === 'manager' ? ['cashier'] : [];
