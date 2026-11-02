import type { RequestHandler } from 'express';
import { can, type Permission } from '@shopstock/shared';
import { forbidden } from '../lib/errors';

/** Every route under loadActor declares one (FR-SCOPE-07). Order: authorize → validate → handler. */
export const authorize =
  (permission: Permission): RequestHandler =>
  (req, _res, next) => {
    if (!can(req.ctx.role, permission)) {
      req.log.warn(
        {
          userId: String(req.ctx.userId),
          branchId: String((req.ctx as { branchId?: unknown }).branchId ?? ''),
          permission,
          route: req.originalUrl,
        },
        'permission denied', // FR-SCOPE-10
      );
      throw forbidden('FORBIDDEN', "You don't have permission to do that.", { permission });
    }
    next();
  };
