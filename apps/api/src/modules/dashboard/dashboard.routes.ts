import { Router } from 'express';
import { can, lowStockQuery, type LowStockListDto } from '@shopstock/shared';
import { authorize } from '../../middleware/authorize';
import { bctx } from '../../middleware/branchCtx';
import { validate, valid } from '../../middleware/validate';
import { lowStock, toLowStockRowDto } from '../inventory/lowStock.service';
import { branchDashboard, overview, shiftDashboard } from './dashboard.service';

/** Mounted at /api/b/:branchCode/dashboard. One route, two shapes (◐ for cashiers). */
export const dashboardRouter = Router({ mergeParams: true });

dashboardRouter.get('/', authorize('dashboard:view'), async (req, res) => {
  const ctx = bctx(req);
  // The cashier payload simply doesn't CONTAIN other people's numbers: nothing to strip.
  res.json(can(ctx.role, 'sale:viewAll') ? await branchDashboard(ctx) : await shiftDashboard(ctx));
});

/** Mounted at /api/b/:branchCode/low-stock. Quantities and levels only, no costs: cashiers may see it. */
export const lowStockRouter = Router({ mergeParams: true });

const LOW_STOCK_LIMIT = 500; // NFR-PERF-08: no unbounded arrays
const lowReq = { query: lowStockQuery };
lowStockRouter.get('/', authorize('inventory:view'), validate(lowReq), async (req, res) => {
  const rows = await lowStock(bctx(req), { ...valid(req, lowReq).query, limit: LOW_STOCK_LIMIT + 1 });
  const body: LowStockListDto = {
    items: rows.slice(0, LOW_STOCK_LIMIT).map(toLowStockRowDto),
    truncated: rows.length > LOW_STOCK_LIMIT,
  };
  res.json(body);
});

/** Mounted at /api/dashboard: shop-wide (all the actor's branches). */
export const overviewRouter = Router();

overviewRouter.get('/overview', authorize('report:view'), async (req, res) => {
  res.json(await overview(req.ctx));
});
