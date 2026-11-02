import { Router } from 'express';
import { authorize } from '../../middleware/authorize';
import { bctx } from '../../middleware/branchCtx';
import { getBranchByCode } from '../../lib/cache';
import { toBranchDto } from './branch.dto';

/** Everything under /api/b/:branchCode hangs off this router (resolveBranch has already run). */
export const branchRouter = Router({ mergeParams: true });

branchRouter.get('/', authorize('branch:view'), async (req, res) => {
  const ctx = bctx(req);
  res.json({ branch: toBranchDto((await getBranchByCode(ctx.branchCode))!) });
});
// Day 8+: branchRouter.use('/inventory', inventoryRouter) · Day 11: '/sales' · Day 14: '/returns' ...
