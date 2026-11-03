import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { can, type Permission } from '@shopstock/shared';
import { forbidden } from '../lib/errors';

/** Marks the middleware, so route-guard.test.ts can prove every route declares one (FR-SCOPE-07). */
export const AUTHZ = Symbol('authorize');

/** Every route under loadActor declares one (FR-SCOPE-07). Order: authorize → validate → handler. */
export const authorize = (permission: Permission): RequestHandler =>
  Object.assign(check(permission), { [AUTHZ]: permission });

/** For the few routes every signed-in user may call (own profile, own password). The reason shows in review. */
export const noPermissionNeeded = (reason: string): RequestHandler =>
  Object.assign((_req: Request, _res: Response, next: NextFunction) => next(), {
    [AUTHZ]: `none: ${reason}`,
  });

const check =
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
