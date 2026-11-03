import { describe, expect, it } from 'vitest';
import { can, type Permission, type Role, type TransferDto } from '@shopstock/shared';
import { transferActions, transferWaiting } from './transferActions';

const t = (status: TransferDto['status']) => ({ status, fromCode: 'GUL', toCode: 'DHN' });
const canAs = (role: Role) => (p: Permission) => can(role, p);

describe('transferActions', () => {
  it.each([
    ['pending', 'GUL', ['dispatch', 'cancel']],
    ['pending', 'DHN', []],
    ['in_transit', 'GUL', []],
    ['in_transit', 'DHN', ['receive']],
    ['received', 'GUL', []],
    ['received', 'DHN', []],
    ['cancelled', 'GUL', []],
    ['cancelled', 'DHN', []],
  ] as const)('%s seen from %s → %j', (status, viewer, expected) => {
    expect(transferActions(t(status), viewer, canAs('manager'))).toEqual(expected);
  });

  it('the Owner acts for the side in the URL, like anyone else', () => {
    expect(transferActions(t('in_transit'), 'GUL', canAs('owner'))).toEqual([]);
    expect(transferActions(t('in_transit'), 'DHN', canAs('owner'))).toEqual(['receive']);
  });

  it('a cashier gets nothing', () => {
    expect(transferActions(t('pending'), 'GUL', canAs('cashier'))).toEqual([]);
    expect(transferActions(t('in_transit'), 'DHN', canAs('cashier'))).toEqual([]);
  });
});

describe('transferWaiting', () => {
  it('tells each side what the other one owes', () => {
    expect(transferWaiting(t('pending'), 'DHN')).toBe('Waiting for GUL to dispatch.');
    expect(transferWaiting(t('in_transit'), 'GUL')).toBe('On its way to DHN.');
    expect(transferWaiting(t('pending'), 'GUL')).toBeNull();
    expect(transferWaiting(t('received'), 'DHN')).toBeNull();
  });
});
