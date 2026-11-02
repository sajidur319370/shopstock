import type { RequestHandler } from 'express';
import { conflict, notFound } from '../lib/errors';
import { getBranchByCode } from '../lib/cache';
import { canAccess, type BranchCtx } from '../types/ctx';

export const resolveBranch: RequestHandler = async (req, _res, next) => {
  const code = String(req.params.branchCode ?? '').toUpperCase();
  const branch = await getBranchByCode(code); // from the cached list
  if (!branch || !canAccess(req.ctx, branch._id)) throw notFound(); // identical answer either way (NFR-SEC-02)

  if (!branch.isActive && !(req.ctx.role === 'owner' && req.method === 'GET')) {
    throw conflict('BRANCH_INACTIVE', `Branch ${branch.code} is inactive.`);
  }
  const ctx: BranchCtx = { ...req.ctx, branchId: branch._id, branchCode: branch.code };
  req.ctx = ctx; // read it back as BranchCtx with bctx(req)
  next();
};
