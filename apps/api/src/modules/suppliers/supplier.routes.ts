import { Router } from 'express';
import { supplierListQuery, supplierSchema, updateSupplierSchema } from '@shopstock/shared';
import { idParams, oid } from '../../lib/ids';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import * as suppliers from './supplier.service';

/** Mounted at /api/suppliers (shop-wide, Manager+). */
export const suppliersRouter = Router();

const listReq = { query: supplierListQuery };
suppliersRouter.get('/', authorize('supplier:view'), validate(listReq), async (req, res) => {
  res.json(await suppliers.listSuppliers(valid(req, listReq).query));
});

const createReq = { body: supplierSchema };
suppliersRouter.post('/', authorize('supplier:manage'), validate(createReq), async (req, res) => {
  res.status(201).json({ supplier: await suppliers.createSupplier(valid(req, createReq).body) });
});

const idReq = { params: idParams };
suppliersRouter.get('/:id', authorize('supplier:view'), validate(idReq), async (req, res) => {
  res.json(await suppliers.getSupplier(req.ctx, oid(valid(req, idReq).params.id))); // { supplier, recentPOs }
});

const updateReq = { params: idParams, body: updateSupplierSchema };
suppliersRouter.patch('/:id', authorize('supplier:manage'), validate(updateReq), async (req, res) => {
  const { params, body } = valid(req, updateReq);
  res.json({ supplier: await suppliers.updateSupplier(oid(params.id), body) });
});
