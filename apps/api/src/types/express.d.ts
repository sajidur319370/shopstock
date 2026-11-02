import type { Types } from 'mongoose';
import type { Ctx } from './ctx';

declare global {
  namespace Express {
    interface Request {
      valid: unknown;
      userId: Types.ObjectId; // set by authenticate
      sessionId: string; // set by authenticate
      ctx: Ctx; // set by loadActor; resolveBranch widens it to BranchCtx
    }
  }
}

export {};
