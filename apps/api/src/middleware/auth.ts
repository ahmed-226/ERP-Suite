import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken, type AccessClaims } from '../lib/jwt';
import { userHasPermission } from '../modules/auth/auth.service';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessClaims;
    }
  }
}

/** 401 unless a valid `Authorization: Bearer <accessToken>` is present. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing bearer token' } });
    return;
  }
  try {
    req.user = verifyAccessToken(header.slice(7));
    next();
  } catch (err) {
    next(err);
  }
}

/** Must run after requireAuth. Resolves permission codes via the Redis cache. */
export function requirePermission(code: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing bearer token' } });
      return;
    }
    const allowed = await userHasPermission(req.user.userId, code);
    if (!allowed) {
      res
        .status(403)
        .json({ error: { code: 'FORBIDDEN', message: `Missing permission: ${code}` } });
      return;
    }
    next();
  };
}
