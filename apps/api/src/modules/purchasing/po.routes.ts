import { Router } from 'express';
import { createPOSchema, poListQuery, receivePOSchema, updatePOSchema } from '@shopstock/shared';
import { idParams, oid } from '../../lib/ids';
import { authorize } from '../../middleware/authorize';
import { bctx } from '../../middleware/branchCtx';
import { validate, valid } from '../../middleware/validate';
import * as po from './po.service';

/** Mounted at /api/b/:branchCode/purchase-orders. */
export const poRouter = Router({ mergeParams: true });

const listReq = { query: poListQuery };
poRouter.get('/', authorize('po:view'), validate(listReq), async (req, res) => {
  res.json(await po.listPOs(bctx(req), valid(req, listReq).query));
});

// Literal paths BEFORE '/:id'.
poRouter.get('/suggestions', authorize('po:manage'), async (req, res) => {
  res.json({ suggestions: await po.suggestions(bctx(req)) });
});

const createReq = { body: createPOSchema };
poRouter.post('/', authorize('po:manage'), validate(createReq), async (req, res) => {
  res.status(201).json({ purchaseOrder: await po.createPO(bctx(req), valid(req, createReq).body) });
});

const idReq = { params: idParams };
poRouter.get('/:id', authorize('po:view'), validate(idReq), async (req, res) => {
  res.json({ purchaseOrder: await po.getPO(bctx(req), oid(valid(req, idReq).params.id)) });
});

const updateReq = { params: idParams, body: updatePOSchema };
poRouter.patch('/:id', authorize('po:manage'), validate(updateReq), async (req, res) => {
  const { params, body } = valid(req, updateReq);
  res.json({ purchaseOrder: await po.updateDraft(bctx(req), oid(params.id), body) });
});

poRouter.delete('/:id', authorize('po:manage'), validate(idReq), async (req, res) => {
  await po.deleteDraft(bctx(req), oid(valid(req, idReq).params.id));
  res.status(204).end();
});

// State transitions: each one a compare-and-set on the current status (409 INVALID_STATE otherwise).
for (const [action, fn] of [
  ['order', po.orderPO],
  ['cancel', po.cancelPO],
  ['close', po.closePO],
] as const) {
  poRouter.post(`/:id/${action}`, authorize('po:manage'), validate(idReq), async (req, res) => {
    res.json({ purchaseOrder: await fn(bctx(req), oid(valid(req, idReq).params.id)) });
  });
}

const receiveReq = { params: idParams, body: receivePOSchema };
poRouter.post('/:id/receive', authorize('po:receive'), validate(receiveReq), async (req, res) => {
  const { params, body } = valid(req, receiveReq);
  res.json(await po.receivePO(bctx(req), oid(params.id), body)); // 200 { purchaseOrder, replayed }
});
