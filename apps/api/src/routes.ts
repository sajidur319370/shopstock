import { Router } from 'express';
import { authenticate } from './middleware/authenticate';
import { setupRouter } from './modules/setup/setup.routes';
import { authRouter } from './modules/auth/auth.routes';
import { meRouter } from './modules/users/me.routes';

export const apiRouter = Router();
apiRouter.use('/setup', setupRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/me', authenticate, meRouter);
