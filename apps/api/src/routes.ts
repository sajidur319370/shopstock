import { Router } from 'express';
import { authenticate } from './middleware/authenticate';
import { loadActor } from './middleware/loadActor';
import { resolveBranch } from './middleware/resolveBranch';
import { setupRouter } from './modules/setup/setup.routes';
import { authRouter } from './modules/auth/auth.routes';
import { meRouter } from './modules/users/me.routes';
import { settingsRouter } from './modules/settings/settings.routes';
import { branchesRouter } from './modules/branches/branches.routes';
import { branchRouter } from './modules/branches/branch.scoped.routes';
import { staffRouter } from './modules/staff/staff.routes';
import { categoriesRouter, productsRouter } from './modules/catalog/catalog.routes';
import { suppliersRouter } from './modules/suppliers/supplier.routes';

export const apiRouter = Router();
apiRouter.use('/setup', setupRouter); // guest
apiRouter.use('/auth', authRouter); // guest / cookie
apiRouter.use('/me', authenticate, loadActor({ allowPasswordChange: true }), meRouter);

// Secure by default: everything below needs an active user (an unknown /api path answers 401, not 404).
apiRouter.use(authenticate, loadActor());
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/branches', branchesRouter);
apiRouter.use('/staff', staffRouter);
apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/products', productsRouter);
apiRouter.use('/suppliers', suppliersRouter);
apiRouter.use('/b/:branchCode', resolveBranch, branchRouter); // POS, inventory, sales, POs, transfers…
