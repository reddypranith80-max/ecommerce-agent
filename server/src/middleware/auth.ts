import type { RequestHandler } from 'express';
import { hasPermission, type Permission, type Role } from '@shop/shared';
import { User, type UserDoc } from '../models/user.model';
import { verifyAccessToken } from '../services/token.service';
import type { Actor } from '../services/audit.service';
import { forbidden, unauthorized } from '../utils/errors';

export interface AuthContext {
  userId: string;
  role: Role;
  sessionId: string;
  user: UserDoc;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

async function resolveAuth(header: string | undefined): Promise<AuthContext> {
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  const claims = await verifyAccessToken(header.slice(7));
  const user = await User.findById(claims.sub);
  if (!user || user.status !== 'active') {
    throw unauthorized('UNAUTHENTICATED', 'Your session has ended. Please sign in again.');
  }
  if (claims.iatMs < user.tokensValidAfter.getTime()) {
    throw unauthorized('UNAUTHENTICATED', 'Your session has ended. Please sign in again.');
  }
  return { userId: user.id as string, role: user.role as Role, sessionId: claims.sid, user };
}

/** Requires a valid access token. Loads the user so blocks and role changes apply immediately. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  req.auth = await resolveAuth(req.headers.authorization);
  next();
};

/** Uses the token when present and valid; otherwise continues as a guest. */
export const optionalAuth: RequestHandler = async (req, _res, next) => {
  if (req.headers.authorization) {
    try {
      req.auth = await resolveAuth(req.headers.authorization);
    } catch {
      req.auth = undefined;
    }
  }
  next();
};

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw unauthorized();
    if (!hasPermission(req.auth.role, permission)) throw forbidden();
    next();
  };
}

export function auth(req: Parameters<RequestHandler>[0]): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function actorOf(req: Parameters<RequestHandler>[0]): Actor {
  const a = auth(req);
  return { type: a.role === 'admin' ? 'admin' : 'customer', id: a.userId, ip: req.ip };
}
