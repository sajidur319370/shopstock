import { Router } from 'express';
import { authorize } from '../../middleware/authorize';
import { bctx } from '../../middleware/branchCtx';
import { getBranchByCode } from '../../lib/cache';
import { inventoryRouter } from '../inventory/inventory.routes';
import { posRouter } from '../pos/pos.routes';
import { poRouter } from '../purchasing/po.routes';
import { transfersRouter } from '../transfers/transfer.routes';
import { returnsRouter } from '../returns/return.routes';
import { salesRouter } from '../sales/sale.routes';
import { toBranchDto } from './branch.dto';

/** Everything under /api/b/:branchCode hangs off this router (resolveBranch has already run). */
export const branchRouter = Router({ mergeParams: true });

branchRouter.get('/', authorize('branch:view'), async (req, res) => {
  const ctx = bctx(req);
  res.json({ branch: toBranchDto((await getBranchByCode(ctx.branchCode))!) });
});
branchRouter.use(inventoryRouter); // /inventory, /adjustments, /stock-counts, /movements, /reconcile
branchRouter.use('/sales', salesRouter);
branchRouter.use('/pos', posRouter);
branchRouter.use('/returns', returnsRouter);
branchRouter.use('/purchase-orders', poRouter);
branchRouter.use('/transfers', transfersRouter);
