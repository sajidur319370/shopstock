import { Router } from 'express';
import { searchQuery } from '@shopstock/shared';
import { authorize } from '../../middleware/authorize';
import { bctx } from '../../middleware/branchCtx';
import { validate, valid } from '../../middleware/validate';
import { posSearch } from './pos.service';

/** Mounted at /api/b/:branchCode/pos. */
export const posRouter = Router({ mergeParams: true });

const searchReq = { query: searchQuery };
posRouter.get('/search', authorize('sale:create'), validate(searchReq), async (req, res) => {
  res.json(await posSearch(bctx(req), valid(req, searchReq).query.q));
});
