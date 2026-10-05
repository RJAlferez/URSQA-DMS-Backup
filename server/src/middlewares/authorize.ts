import type { Request, Response, NextFunction } from "express";
import type { RoleName } from "@prisma/client";
import { ForbiddenError } from "@/utils/errors";
import { AUDIT_ACTIONS } from "@/config/constants";
import { writeAudit } from "@/modules/audit/audit.service";

export function requireRole(...allowed: RoleName[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.auth) {
      next(new ForbiddenError("Not authenticated"));
      return;
    }
    if (!allowed.includes(req.auth.roleName)) {
      // Awaited (not fire-and-forget) so the denial is persisted before the
      // 403 propagates — matching requirePermission/requireAnyPermission and
      // guaranteeing the security event is never lost on shutdown.
      await writeAudit({
        action: AUDIT_ACTIONS.PERMISSION_DENIED,
        userId: req.auth.userId,
        entity: "route",
        entityId: req.originalUrl,
        ipAddress: req.context.ipAddress,
        userAgent: req.context.userAgent,
        newValue: {
          reason: "role_check_failed",
          requiredRoles: allowed,
          actualRole: req.auth.roleName,
        },
        category: "SECURITY",
        severity: "WARNING",
        result: "DENIED",
      });
      next(new ForbiddenError(`Requires role: ${allowed.join(", ")}`));
      return;
    }
    next();
  };
}

export function requirePermission(...required: string[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.auth) {
        next(new ForbiddenError("Not authenticated"));
        return;
      }
      const have = new Set(req.auth.permissions);
      const missing = required.filter((p) => !have.has(p));
      if (missing.length > 0) {
        await writeAudit({
          action: AUDIT_ACTIONS.PERMISSION_DENIED,
          userId: req.auth.userId,
          entity: "route",
          entityId: req.originalUrl,
          ipAddress: req.context.ipAddress,
          userAgent: req.context.userAgent,
          newValue: {
            reason: "permission_check_failed",
            required,
            missing,
          },
          category: "SECURITY",
          severity: "WARNING",
          result: "DENIED",
        });
        next(new ForbiddenError(`Missing permission(s): ${missing.join(", ")}`));
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireAnyPermission(...allowed: string[]) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.auth) {
        next(new ForbiddenError("Not authenticated"));
        return;
      }
      if (allowed.some((permission) => req.auth!.permissions.includes(permission))) {
        next();
        return;
      }
      await writeAudit({
        action: AUDIT_ACTIONS.PERMISSION_DENIED,
        userId: req.auth.userId,
        entity: "route",
        entityId: req.originalUrl,
        ipAddress: req.context.ipAddress,
        userAgent: req.context.userAgent,
        newValue: {
          reason: "any_permission_check_failed",
          allowed,
        },
        category: "SECURITY",
        severity: "WARNING",
        result: "DENIED",
      });
      next(new ForbiddenError(`Requires one of: ${allowed.join(", ")}`));
    } catch (err) {
      next(err);
    }
  };
}
