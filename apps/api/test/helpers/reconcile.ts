import { expect } from 'vitest';
import { Branch } from '../../src/db/models';
import { reconcile } from '../../src/modules/inventory/reconcile.service';

/** Every inventory row in every branch: Σ movements == quantity and latest quantityAfter == quantity. */
export async function expectReconciled() {
  const branches = await Branch.find().select('_id code').lean();
  for (const b of branches) {
    const mismatches = await reconcile({ branchId: b._id });
    expect(mismatches, `reconciliation failed at ${b.code}`).toEqual([]);
  }
}
