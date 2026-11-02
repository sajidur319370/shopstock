import { Router } from 'express';
import { z } from 'zod';
import { createSaleSchema, salesListQuery } from '@shopstock/shared';
import { authorize } from '../../middleware/authorize';
import { bctx } from '../../middleware/branchCtx';
import { validate, valid } from '../../middleware/validate';
import { idParams, oid } from '../../lib/ids';
import {
  createSale,
  getSale,
  getSaleByInvoice,
  listSales,
  markPrinted,
  myShiftSummary,
} from './sale.service';

/** Mounted at /api/b/:branchCode/sales. */
export const salesRouter = Router({ mergeParams: true });

const createReq = { body: createSaleSchema };
salesRouter.post('/', authorize('sale:create'), validate(createReq), async (req, res) => {
  const { sale, replayed } = await createSale(bctx(req), valid(req, createReq).body);
  // 201 = created now; 200 + replayed = "you already made this sale" (a retry): the POS treats both as success.
  res.status(replayed ? 200 : 201).json({ sale, replayed });
});

// Cashiers see only their own sales: the service filters, so `sale:view` is enough here (◐).
const listReq = { query: salesListQuery };
salesRouter.get('/', authorize('sale:view'), validate(listReq), async (req, res) => {
  res.json(await listSales(bctx(req), valid(req, listReq).query));
});

// Literal paths BEFORE '/:id', or Express would treat "my-summary" as an id.
salesRouter.get('/my-summary', authorize('sale:view'), async (req, res) => {
  res.json({ summary: await myShiftSummary(bctx(req)) });
});

const invoiceReq = { params: z.object({ invoiceNo: z.string().trim().min(1).max(20) }) };
salesRouter.get('/by-invoice/:invoiceNo', authorize('sale:view'), validate(invoiceReq), async (req, res) => {
  res.json({ sale: await getSaleByInvoice(bctx(req), valid(req, invoiceReq).params.invoiceNo) });
});

const idReq = { params: idParams };
salesRouter.get('/:id', authorize('sale:view'), validate(idReq), async (req, res) => {
  res.json({ sale: await getSale(bctx(req), oid(valid(req, idReq).params.id)) });
});

salesRouter.post('/:id/printed', authorize('invoice:print'), validate(idReq), async (req, res) => {
  res.json(await markPrinted(bctx(req), oid(valid(req, idReq).params.id)));
});
