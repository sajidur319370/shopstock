import type { Request } from 'express';
import type { BranchCtx } from '../types/ctx';

/** Use in handlers mounted under /b/:branchCode. Throws if resolveBranch didn't run (a wiring bug). */
export function bctx(req: Request): BranchCtx {
  const c = req.ctx as Partial<BranchCtx>;
  if (!c.branchId) throw new Error('bctx() used on a route without resolveBranch');
  return c as BranchCtx;
}
