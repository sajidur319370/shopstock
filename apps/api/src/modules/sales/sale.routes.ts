import { Router } from 'express';
import { createSaleSchema } from '@shopstock/shared';
import { authorize } from '../../middleware/authorize';
import { bctx } from '../../middleware/branchCtx';
import { validate, valid } from '../../middleware/validate';
import { createSale } from './sale.service';

/** Mounted at /api/b/:branchCode/sales. */
export const salesRouter = Router({ mergeParams: true });

const createReq = { body: createSaleSchema };
salesRouter.post('/', authorize('sale:create'), validate(createReq), async (req, res) => {
  const { sale, replayed } = await createSale(bctx(req), valid(req, createReq).body);
  // 201 = created now; 200 + replayed = "you already made this sale" (a retry): the POS treats both as success.
  res.status(replayed ? 200 : 201).json({ sale, replayed });
});
// Day 13: GET / (history), GET /:id (detail), POST /:id/printed
