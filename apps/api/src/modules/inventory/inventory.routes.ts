import { Router } from 'express';
import { z } from 'zod';
import {
  adjustmentSchema,
  inventoryListQuery,
  movementQuery,
  objectIdSchema,
  reorderLevelSchema,
  stockCountSchema,
} from '@shopstock/shared';
import { oid } from '../../lib/ids';
import { authorize } from '../../middleware/authorize';
import { bctx } from '../../middleware/branchCtx';
import { validate, valid } from '../../middleware/validate';
import { createAdjustment, submitStockCount } from './adjustment.service';
import { getInventoryRow, listInventory, setReorderLevel } from './inventory.service';
import { listMovements } from './movement.service';
import { reconcile } from './reconcile.service';

/** Mounted on the branch router: every path is under /api/b/:branchCode and every handler uses bctx(). */
export const inventoryRouter = Router({ mergeParams: true });

const listReq = { query: inventoryListQuery };
inventoryRouter.get('/inventory', authorize('inventory:view'), validate(listReq), async (req, res) => {
  res.json(await listInventory(bctx(req), valid(req, listReq).query));
});

const productParams = z.object({ productId: objectIdSchema });
const rowReq = { params: productParams };
inventoryRouter.get(
  '/inventory/:productId',
  authorize('inventory:view'),
  validate(rowReq),
  async (req, res) => {
    res.json(await getInventoryRow(bctx(req), oid(valid(req, rowReq).params.productId)));
  },
);

const reorderReq = { params: productParams, body: reorderLevelSchema };
inventoryRouter.patch(
  '/inventory/:productId',
  authorize('inventory:configure'),
  validate(reorderReq),
  async (req, res) => {
    const { params, body } = valid(req, reorderReq);
    res.json(await setReorderLevel(bctx(req), oid(params.productId), body.reorderLevel));
  },
);

const adjReq = { body: adjustmentSchema };
inventoryRouter.post('/adjustments', authorize('inventory:adjust'), validate(adjReq), async (req, res) => {
  res.status(201).json(await createAdjustment(bctx(req), valid(req, adjReq).body));
});

const countReq = { body: stockCountSchema };
inventoryRouter.post('/stock-counts', authorize('inventory:adjust'), validate(countReq), async (req, res) => {
  res.status(201).json(await submitStockCount(bctx(req), valid(req, countReq).body));
});

const moveReq = { query: movementQuery };
inventoryRouter.get('/movements', authorize('movement:view'), validate(moveReq), async (req, res) => {
  res.json(await listMovements(bctx(req), valid(req, moveReq).query));
});

const reconcileReq = { query: z.object({ productId: objectIdSchema.optional() }) };
inventoryRouter.get('/reconcile', authorize('reconcile:run'), validate(reconcileReq), async (req, res) => {
  const { productId } = valid(req, reconcileReq).query;
  const mismatches = await reconcile(bctx(req), productId ? oid(productId) : undefined);
  res.json({ ok: mismatches.length === 0, mismatches });
});
