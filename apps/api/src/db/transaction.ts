import mongoose, { type ClientSession } from 'mongoose';
import { logger } from '../lib/logger';

/**
 * Runs fn inside a transaction. The driver RETRIES fn on transient errors
 * (write conflicts), so fn must be safe to run more than once:
 * no HTTP calls, no emails, no printing, no state that survives an attempt.
 */
export async function withTransaction<T>(
  fn: (session: ClientSession) => Promise<T>,
  label = 'tx',
): Promise<T> {
  const session = await mongoose.startSession();
  let attempts = 0;
  try {
    let result!: T;
    await session.withTransaction(
      async () => {
        attempts++;
        result = await fn(session);
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' },
    );
    if (attempts > 1) logger.debug({ label, attempts }, 'transaction retried');
    if (attempts > 5) logger.warn({ label, attempts }, 'transaction retried many times'); // NFR-OBS-04
    return result;
  } finally {
    await session.endSession();
  }
}
