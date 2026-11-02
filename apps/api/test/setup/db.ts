import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { syncAllIndexes } from '../../src/db/indexes';
import { applyValidators } from '../../src/db/validators';

let replSet: MongoMemoryReplSet | undefined;

export async function startTestDb() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri('shopstock_test'));
  await applyValidators(); // FIRST: creates inventory WITH the validator (AC-INV-03 relies on it)
  await syncAllIndexes(); // unique & partial indexes must exist: tests rely on them
}

export async function clearTestDb() {
  const { collections } = mongoose.connection;
  // Raw driver deleteMany: bypasses the append-only hook on stockMovements (test harness only).
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

export async function stopTestDb() {
  await mongoose.disconnect();
  await replSet?.stop();
}
