/**
 * TR-09: a DISPOSABLE production server for Playwright: a fresh in-memory replica set every run (the
 * first journey is the setup wizard), NODE_ENV=production so it serves the built web app like Render.
 * Started by playwright.config.ts (`npm run e2e:server -w @shopstock/api`).
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
Object.assign(process.env, {
  NODE_ENV: 'production', // serve apps/web/dist, same as Render
  PORT: '4100',
  MONGODB_URI: rs.getUri('shopstock_e2e'),
  MONGODB_OPS_URI: rs.getUri('shopstock_e2e'), // never a database from apps/api/.env
  APP_URL: 'http://localhost:4100',
  JWT_ACCESS_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0123456789',
  BCRYPT_ROUNDS: '4',
  LOG_LEVEL: 'warn',
}); // no SETUP_TOKEN: the wizard journey runs without one

// Validators + indexes, as db-sync does. Imported AFTER setting env: config is read at import time.
const { connectDb, disconnectDb } = await import('../src/db/connection');
const { applyValidators } = await import('../src/db/validators');
const { syncAllIndexes } = await import('../src/db/indexes');
await connectDb(process.env.MONGODB_URI);
await applyValidators();
await syncAllIndexes();
await disconnectDb();
await import('../src/server'); // connects again and listens on :4100

const stop = async () => {
  await rs.stop();
  process.exit(0);
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
