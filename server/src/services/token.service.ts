import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import type { Role } from '@shop/shared';
import { env } from '../config/env';
import { unauthorized } from '../utils/errors';

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = 'storefront-api';
const AUDIENCE = 'storefront-web';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export interface AccessClaims {
  sub: string;
  role: Role;
  sid: string;
  iat: number;
  /** Millisecond issue time, so revocation (tokensValidAfter) is exact rather than second-granular. */
  iatMs: number;
}

export async function signAccessToken(userId: string, role: Role, sessionId: string): Promise<string> {
  return new SignJWT({ role, sid: sessionId, iatMs: Date.now() })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, secret, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || typeof payload.iat !== 'number') {
      throw unauthorized();
    }
    const iatMs = typeof payload.iatMs === 'number' ? payload.iatMs : payload.iat * 1000;
    return { sub: payload.sub, role: payload.role as Role, sid: payload.sid, iat: payload.iat, iatMs };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) throw unauthorized('TOKEN_EXPIRED', 'Your session token has expired.');
    throw unauthorized('UNAUTHENTICATED', 'Your session is not valid. Please sign in again.');
  }
}
