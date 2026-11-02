import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { invalidateCache } from '../../src/lib/cache';
import { expectReconciled } from '../helpers/reconcile';
import { clearTestDb, startTestDb, stopTestDb } from './db';

beforeAll(startTestDb);
beforeEach(async () => {
  await clearTestDb();
  invalidateCache(); // otherwise one test's settings/branches leak into the next
});
afterEach(expectReconciled); // TR-06: from Day 8 on, EVERY test ends with a reconciliation
afterAll(stopTestDb);
