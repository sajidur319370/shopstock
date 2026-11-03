/**
 * database.md §15/§18: every branch, every inventory row: Σ movements == quantity and the latest
 * movement's quantityAfter == quantity. Exit code 1 on any mismatch (run it after a restore or a seed).
 */
import mongoose from 'mongoose';
import { env } from '../src/config/env';
import { connectDb } from '../src/db/connection';
import { Branch, Inventory } from '../src/db/models';
import { reconcile } from '../src/modules/inventory/reconcile.service';

await connectDb(process.env.MONGODB_OPS_URI ?? env.MONGODB_URI);
let bad = 0;
for (const b of await Branch.find().sort({ code: 1 }).lean()) {
  const rows = await Inventory.countDocuments({ branchId: b._id });
  const mismatches = await reconcile({ branchId: b._id });
  bad += mismatches.length;
  console.log(
    `${b.code.padEnd(8)} ${rows.toLocaleString('en').padStart(7)} rows checked  ${mismatches.length} mismatches`,
  );
  for (const m of mismatches.slice(0, 5)) console.log('   ', JSON.stringify(m));
}
await mongoose.disconnect();
process.exit(bad ? 1 : 0);
