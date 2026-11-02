import { Branch } from '../../src/db/models';
import { invalidateCache } from '../../src/lib/cache';
import { as, makeUser, setupShop } from '../helpers/auth';

/** GUL + DHN, an owner, and a manager + cashier per branch. Use it in every test from now on. */
export async function makeShop() {
  const owner = await setupShop(); // creates GUL
  const dhnRes = await as(owner.token).post('/api/branches').send({ code: 'DHN', name: 'Dhanmondi' });
  if (dhnRes.status !== 201) throw new Error(JSON.stringify(dhnRes.body));
  invalidateCache();
  const gul = (await Branch.findOne({ code: 'GUL' }).lean())!;
  const dhn = (await Branch.findOne({ code: 'DHN' }).lean())!;

  const [managerGul, cashierGul, managerDhn, cashierDhn] = await Promise.all([
    makeUser('manager', [gul._id]),
    makeUser('cashier', [gul._id]),
    makeUser('manager', [dhn._id]),
    makeUser('cashier', [dhn._id]),
  ]);
  return { owner, gul, dhn, managerGul, cashierGul, managerDhn, cashierDhn };
}
export type Shop = Awaited<ReturnType<typeof makeShop>>;
