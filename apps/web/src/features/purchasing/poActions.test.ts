import { describe, expect, it } from 'vitest';
import { can, type PODto, type Permission, type Role } from '@shopstock/shared';
import { poActions } from './poActions';

const po = (status: PODto['status'], receivedQty = 0) => ({
  status,
  items: [{ receivedQty } as PODto['items'][number]],
});
const canAs = (role: Role) => (p: Permission) => can(role, p);

describe('poActions', () => {
  it.each([
    ['draft', 0, ['edit', 'order', 'delete', 'cancel']],
    ['ordered', 0, ['receive', 'cancel']],
    ['partially_received', 3, ['receive', 'close']],
    ['received', 10, []],
    ['cancelled', 0, []],
    ['closed', 3, []],
  ] as const)('%s → %j', (status, received, expected) => {
    expect(poActions(po(status, received), canAs('manager'))).toEqual(expected);
  });

  it('the Owner gets the same buttons as a manager', () => {
    expect(poActions(po('ordered'), canAs('owner'))).toEqual(['receive', 'cancel']);
  });

  it('a cashier gets nothing, in every state', () => {
    for (const s of ['draft', 'ordered', 'partially_received'] as const) {
      expect(poActions(po(s), canAs('cashier'))).toEqual([]);
    }
  });

  it('receive without manage: only Receive (no cancel or close)', () => {
    const receiveOnly = (p: Permission) => p === 'po:receive';
    expect(poActions(po('ordered'), receiveOnly)).toEqual(['receive']);
    expect(poActions(po('partially_received', 2), receiveOnly)).toEqual(['receive']);
    expect(poActions(po('draft'), receiveOnly)).toEqual([]);
  });
});
