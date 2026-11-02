import type { SetupInput } from '@shopstock/shared';
import { Branch, Settings, User } from '../../db/models';
import { withTransaction } from '../../db/transaction';
import { createBranchCounters } from '../../db/counters';
import { conflict } from '../../lib/errors';
import { hashPassword } from '../../lib/password';
import { isDuplicateKey } from '../../lib/mongoErrors';

export async function needsSetup() {
  return !(await Settings.exists({ _id: 'shop' }));
}

export async function setup(input: SetupInput, now = new Date()) {
  const passwordHash = await hashPassword(input.owner.password); // slow: keep it OUTSIDE the transaction
  try {
    return await withTransaction(async (session) => {
      await Settings.create(
        [
          {
            _id: 'shop',
            shopName: input.shopName,
            currency: input.currency,
            timezone: input.timezone,
            taxRateBps: input.taxRateBps,
            setupAt: now,
          },
        ],
        { session },
      );
      const [owner] = await User.create(
        [{ email: input.owner.email, name: input.owner.name, passwordHash, role: 'owner', branchIds: [] }],
        { session },
      );
      const [branch] = await Branch.create([{ ...input.branch, createdBy: owner!._id }], { session });
      await createBranchCounters(branch!._id, session);
      return { owner: owner!, branch: branch! };
    }, 'setup');
  } catch (err) {
    // The second setup hits the settings _id (or the one_owner index), maybe after a write-conflict retry.
    if (isDuplicateKey(err, '_id_') || isDuplicateKey(err, 'one_owner')) {
      throw conflict('ALREADY_SET_UP', 'This shop is already set up.');
    }
    throw err;
  }
}
