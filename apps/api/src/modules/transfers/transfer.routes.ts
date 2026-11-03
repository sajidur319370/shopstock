import { Router } from 'express';
import { createTransferSchema, transferListQuery } from '@shopstock/shared';
import { idParams, oid } from '../../lib/ids';
import { authorize } from '../../middleware/authorize';
import { bctx } from '../../middleware/branchCtx';
import { validate, valid } from '../../middleware/validate';
import * as transfers from './transfer.service';

/** Mounted at /api/b/:branchCode/transfers. The URL's branch is the side the actor acts for. */
export const transfersRouter = Router({ mergeParams: true });

const listReq = { query: transferListQuery };
transfersRouter.get('/', authorize('transfer:view'), validate(listReq), async (req, res) => {
  res.json(await transfers.listTransfers(bctx(req), valid(req, listReq).query));
});

// Literal paths BEFORE '/:id'.
transfersRouter.get('/destinations', authorize('transfer:manage'), async (req, res) => {
  res.json({ branches: await transfers.destinations(bctx(req)) });
});

const createReq = { body: createTransferSchema };
transfersRouter.post('/', authorize('transfer:manage'), validate(createReq), async (req, res) => {
  res.status(201).json({ transfer: await transfers.createTransfer(bctx(req), valid(req, createReq).body) });
});

const idReq = { params: idParams };
transfersRouter.get('/:id', authorize('transfer:view'), validate(idReq), async (req, res) => {
  res.json({ transfer: await transfers.getTransfer(bctx(req), oid(valid(req, idReq).params.id)) });
});

// dispatch: source only · receive: destination only · cancel: source, pending only. Each returns the fresh transfer.
for (const [action, fn] of [
  ['dispatch', transfers.dispatchTransfer],
  ['receive', transfers.receiveTransfer],
  ['cancel', transfers.cancelTransfer],
] as const) {
  transfersRouter.post(`/:id/${action}`, authorize('transfer:manage'), validate(idReq), async (req, res) => {
    res.json({ transfer: await fn(bctx(req), oid(valid(req, idReq).params.id)) });
  });
}
