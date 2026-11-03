import { createServer } from 'node:http';
import { createApp } from './app';
import { env, isProd } from './config/env';
import { connectDb, disconnectDb } from './db/connection';
import { applyValidators } from './db/validators';
import { logger } from './lib/logger';

const app = createApp();
const server = createServer(app);

await connectDb();
// Dev convenience: autoIndex creates `inventory` WITHOUT the validator. Production runs `npm run db:sync`.
if (!isProd) await applyValidators();
server.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));

/**
 * NFR-REL-05: Render sends SIGTERM on every deploy. Stop accepting connections, let in-flight requests
 * (a sale mid-transaction) finish, then close the pool. A hard stop after 10 s if something hangs.
 */
let closing = false;
function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  logger.info({ signal }, 'shutting down');
  server.close(async () => {
    await disconnectDb();
    logger.info('closed cleanly');
    process.exit(0);
  });
  server.closeIdleConnections(); // keep-alive sockets with no request in flight
  setTimeout(() => {
    logger.warn('forced exit after 10 s');
    process.exit(1);
  }, 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
