/**
 * Release step (and a one-off locally): validators FIRST, then indexes (database.md §7).
 * Validators first: applyValidators() creates `inventory` WITH its validator if it doesn't exist yet;
 * syncIndexes would otherwise create it without one. Note syncIndexes DROPS indexes not in a schema.
 */
import { connectDb, disconnectDb } from '../src/db/connection';
import { syncAllIndexes } from '../src/db/indexes';
import { applyValidators } from '../src/db/validators';

await connectDb(process.env.MONGODB_OPS_URI ?? process.env.MONGODB_URI);
await applyValidators();
await syncAllIndexes();
await disconnectDb();
console.log('✅ validators + indexes in sync');
