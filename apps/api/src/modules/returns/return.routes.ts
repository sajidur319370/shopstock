import { Router } from 'express';
import { createReturnSchema, returnsListQuery } from '@shopstock/shared';
import { authorize } from '../../middleware/authorize';
import { bctx } from '../../middleware/branchCtx';
import { validate, valid } from '../../middleware/validate';
import { idParams, oid } from '../../lib/ids';
import { createReturn, getReturn, listReturns } from './return.service';

/** Mounted at /api/b/:branchCode/returns. */
export const returnsRouter = Router({ mergeParams: true });

const createReq = { body: createReturnSchema };
returnsRouter.post('/', authorize('return:create'), validate(createReq), async (req, res) => {
  const result = await createReturn(bctx(req), valid(req, createReq).body);
  // 201 = created now; 200 + replayed = a retry of a return that already went through.
  res.status(result.replayed ? 200 : 201).json(result);
});

const listReq = { query: returnsListQuery };
returnsRouter.get('/', authorize('return:view'), validate(listReq), async (req, res) => {
  res.json(await listReturns(bctx(req), valid(req, listReq).query));
});

const idReq = { params: idParams };
returnsRouter.get('/:id', authorize('return:view'), validate(idReq), async (req, res) => {
  res.json({ return: await getReturn(bctx(req), oid(valid(req, idReq).params.id)) });
});
