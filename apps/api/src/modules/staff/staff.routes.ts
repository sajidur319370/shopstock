import { Router } from 'express';
import { createStaffSchema, resetStaffPasswordSchema, updateStaffSchema } from '@shopstock/shared';
import { idParams, oid } from '../../lib/ids';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import * as svc from './staff.service';

/** /api/staff: the role ceiling lives in the service (assertCanManage). */
export const staffRouter = Router();

staffRouter.get('/', authorize('staff:view'), async (req, res) => {
  res.json({ staff: await svc.listStaff(req.ctx) });
});

const createReq = { body: createStaffSchema };
staffRouter.post('/', authorize('staff:manage'), validate(createReq), async (req, res) => {
  res.status(201).json({ staff: await svc.createStaff(req.ctx, valid(req, createReq).body) });
});

const updateReq = { params: idParams, body: updateStaffSchema };
staffRouter.patch('/:id', authorize('staff:manage'), validate(updateReq), async (req, res) => {
  const { params, body } = valid(req, updateReq);
  res.json({ staff: await svc.updateStaff(req.ctx, oid(params.id), body) });
});

const resetReq = { params: idParams, body: resetStaffPasswordSchema };
staffRouter.post('/:id/reset-password', authorize('staff:manage'), validate(resetReq), async (req, res) => {
  const { params, body } = valid(req, resetReq);
  await svc.resetStaffPassword(req.ctx, oid(params.id), body.temporaryPassword);
  res.status(204).end();
});
