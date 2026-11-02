import { Router } from 'express';
import { createBranchSchema, updateBranchSchema } from '@shopstock/shared';
import { idParams, oid } from '../../lib/ids';
import { authorize } from '../../middleware/authorize';
import { validate, valid } from '../../middleware/validate';
import * as svc from './branch.service';

/** /api/branches: shop-level branch admin (not branch-scoped). */
export const branchesRouter = Router();

branchesRouter.get('/', authorize('branch:view'), async (req, res) => {
  res.json({ branches: await svc.listMyBranches(req.ctx) });
});

const createReq = { body: createBranchSchema };
branchesRouter.post('/', authorize('branch:manage'), validate(createReq), async (req, res) => {
  res.status(201).json({ branch: await svc.createBranch(req.ctx, valid(req, createReq).body) });
});

const updateReq = { params: idParams, body: updateBranchSchema };
branchesRouter.patch('/:id', authorize('branch:manage'), validate(updateReq), async (req, res) => {
  const { params, body } = valid(req, updateReq);
  res.json({ branch: await svc.updateBranch(req.ctx, oid(params.id), body) });
});
