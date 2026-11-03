import { Router } from 'express';
import { bestSellersQuery, monthlyQuery, periodQuery } from '@shopstock/shared';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import { bestSellers, dailySales, monthlyTrends, profitByBranch } from './report.service';
import { assertPeriod } from './scope';

/**
 * Mounted at /api/reports: shop-wide, NOT under /b/:code. Reports span branches, so there's no
 * resolveBranch; each service narrows `branchIds` to the actor's own (FR-SCOPE-05).
 */
export const reportsRouter = Router();

const periodReq = { query: periodQuery };
reportsRouter.get('/daily-sales', authorize('report:view'), validate(periodReq), async (req, res) => {
  const q = valid(req, periodReq).query;
  assertPeriod(q);
  res.json(await dailySales(req.ctx, q));
});

const bestReq = { query: bestSellersQuery };
reportsRouter.get('/best-sellers', authorize('report:view'), validate(bestReq), async (req, res) => {
  const q = valid(req, bestReq).query;
  assertPeriod(q);
  res.json(await bestSellers(req.ctx, q));
});

reportsRouter.get('/profit', authorize('report:view'), validate(periodReq), async (req, res) => {
  const q = valid(req, periodReq).query;
  assertPeriod(q);
  res.json(await profitByBranch(req.ctx, q));
});

const monthlyReq = { query: monthlyQuery };
reportsRouter.get('/monthly', authorize('report:view'), validate(monthlyReq), async (req, res) => {
  res.json(await monthlyTrends(req.ctx, valid(req, monthlyReq).query));
});
