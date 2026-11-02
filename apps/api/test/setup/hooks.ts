import { afterAll, beforeAll, beforeEach } from 'vitest';
import { invalidateCache } from '../../src/lib/cache';
import { clearTestDb, startTestDb, stopTestDb } from './db';

beforeAll(startTestDb);
beforeEach(async () => {
  await clearTestDb();
  invalidateCache(); // otherwise one test's settings/branches leak into the next
});
afterAll(stopTestDb);
