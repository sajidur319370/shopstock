import { Router } from 'express';
import { authenticate } from './middleware/authenticate';
import { loadActor } from './middleware/loadActor';
import { apiLimiter } from './middleware/rateLimits';
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
import { overviewRouter } from './modules/dashboard/dashboard.routes';
import { reportsRouter } from './modules/reports/report.routes';

export const apiRouter = Router();
apiRouter.use('/setup', setupRouter); // guest
apiRouter.use('/auth', authRouter); // guest / cookie
apiRouter.use('/me', authenticate, loadActor({ allowPasswordChange: true }), apiLimiter, meRouter);

// Secure by default: everything below needs an active user (an unknown /api path answers 401, not 404).
apiRouter.use(authenticate, loadActor(), apiLimiter); // the limit is per USER: after loadActor
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/branches', branchesRouter);
apiRouter.use('/staff', staffRouter);
apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/products', productsRouter);
apiRouter.use('/suppliers', suppliersRouter);
apiRouter.use('/dashboard', overviewRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/b/:branchCode', resolveBranch, branchRouter); // POS, inventory, sales, POs, transfers…
