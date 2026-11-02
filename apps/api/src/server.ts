import { createServer } from 'node:http';
import { createApp } from './app';
import { env, isProd } from './config/env';
import { connectDb } from './db/connection';
import { applyValidators } from './db/validators';
import { logger } from './lib/logger';

const app = createApp();
const server = createServer(app);

await connectDb();
// Dev convenience: autoIndex creates `inventory` WITHOUT the validator. Production runs `npm run db:sync`.
if (!isProd) await applyValidators();
server.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));
