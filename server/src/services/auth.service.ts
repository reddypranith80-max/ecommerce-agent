import bcrypt from 'bcryptjs';
import { permissionsFor, type PublicUser, type Role } from '@shop/shared';
import { env, isTest } from '../config/env';
import { sendMail } from '../integrations/mailer';
import { PasswordResetToken, Session, User, type UserDoc } from '../models/user.model';
import { randomToken, sha256 } from '../utils/crypto';
import { AppError, conflict, forbidden, unauthorized } from '../utils/errors';
import { isDuplicateKeyError } from '../config/db';
import { signAccessToken } from './token.service';

const BCRYPT_COST = isTest ? 4 : 12; // full cost everywhere except the test suite
// Compared against when the email does not exist, so response time does not reveal registered emails.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);

const DAY = 24 * 3600 * 1000;
const SESSION_POLICY: Record<Role, { idleMs: number; absoluteMs: number }> = {
  customer: { idleMs: 30 * DAY, absoluteMs: 90 * DAY },
  admin: { idleMs: 12 * 3600 * 1000, absoluteMs: 12 * 3600 * 1000 },
};
const ROTATION_GRACE_MS = 30_000;

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

export interface SessionTokens {
  user: PublicUser;
  accessToken: string;
  refreshToken?: string;
  refreshExpiresAt?: Date;
}

export function toPublicUser(u: UserDoc): PublicUser {
  return {
    id: u.id as string,
    name: u.name,
    email: u.email,
    phone: u.phone ?? null,
    role: u.role as Role,
    permissions: permissionsFor(u.role as Role),
    createdAt: (u.get('createdAt') as Date).toISOString(),
  };
}

async function createSession(user: UserDoc, meta: ClientMeta): Promise<SessionTokens> {
  const policy = SESSION_POLICY[user.role as Role];
  const refreshToken = randomToken();
  const now = Date.now();
  const absoluteExpiresAt = new Date(now + policy.absoluteMs);
  const expiresAt = new Date(Math.min(now + policy.idleMs, absoluteExpiresAt.getTime()));
  const session = await Session.create({
    userId: user._id,
    currentHash: sha256(refreshToken),
    expiresAt,
    absoluteExpiresAt,
    lastUsedAt: new Date(),
    userAgent: meta.userAgent?.slice(0, 300),
    ip: meta.ip,
  });
  return {
    user: toPublicUser(user),
    accessToken: await signAccessToken(user.id as string, user.role as Role, session.id as string),
    refreshToken,
    refreshExpiresAt: expiresAt,
  };
}

export async function register(input: { name: string; email: string; password: string }, meta: ClientMeta) {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_COST);
  try {
    const user = await User.create({ name: input.name, email: input.email, passwordHash, role: 'customer' });
    return createSession(user, meta);
  } catch (err) {
    // Accepted enumeration trade-off, documented in ARCHITECTURE.md §9.
    if (isDuplicateKeyError(err, 'email')) throw conflict('EMAIL_TAKEN', 'An account with this email already exists.');
    throw err;
  }
}

export async function login(input: { email: string; password: string }, meta: ClientMeta) {
  const user = await User.findOne({ email: input.email }).select('+passwordHash');
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized('INVALID_CREDENTIALS', 'Email or password is incorrect.');
  if (user.status !== 'active') throw forbidden('This account has been blocked. Contact support.', 'ACCOUNT_BLOCKED');
  user.lastLoginAt = new Date();
  await user.save();
  return createSession(user, meta);
}

/**
 * Rotating refresh tokens, one session document per sign-in:
 * - current token → rotate and set a new cookie;
 * - previous token within 30 s (another tab raced us) → new access token, no rotation;
 * - previous token after the grace window → token reuse → revoke the session.
 */
export async function refresh(refreshToken: string | undefined): Promise<SessionTokens> {
  if (!refreshToken) throw unauthorized('INVALID_REFRESH_TOKEN', 'Please sign in again.');
  const hash = sha256(refreshToken);
  const now = new Date();

  let session = await Session.findOne({ currentHash: hash });
  let rotate = true;
  if (!session) {
    session = await Session.findOne({ previousHash: hash });
    if (!session) throw unauthorized('INVALID_REFRESH_TOKEN', 'Please sign in again.');
    if (!session.previousValidUntil || session.previousValidUntil < now) {
      session.revokedAt = now;
      await session.save();
      throw unauthorized('INVALID_REFRESH_TOKEN', 'Your session was ended for security. Please sign in again.');
    }
    rotate = false;
  }
  if (session.revokedAt || session.expiresAt < now || session.absoluteExpiresAt < now) {
    throw unauthorized('INVALID_REFRESH_TOKEN', 'Your session has ended. Please sign in again.');
  }

  const user = await User.findById(session.userId);
  if (!user || user.status !== 'active') {
    session.revokedAt = now;
    await session.save();
    throw unauthorized('INVALID_REFRESH_TOKEN', 'Your session has ended. Please sign in again.');
  }

  const accessToken = await signAccessToken(user.id as string, user.role as Role, session.id as string);
  if (!rotate) return { user: toPublicUser(user), accessToken };

  const policy = SESSION_POLICY[user.role as Role];
  const next = randomToken();
  const expiresAt = new Date(Math.min(now.getTime() + policy.idleMs, session.absoluteExpiresAt.getTime()));
  const updated = await Session.findOneAndUpdate(
    { _id: session._id, currentHash: hash },
    {
      $set: {
        previousHash: hash,
        previousValidUntil: new Date(now.getTime() + ROTATION_GRACE_MS),
        currentHash: sha256(next),
        expiresAt,
        lastUsedAt: now,
      },
    },
  );
  if (!updated) {
    // Lost a race with another tab's rotation: we are now within the grace window.
    return { user: toPublicUser(user), accessToken };
  }
  return { user: toPublicUser(user), accessToken, refreshToken: next, refreshExpiresAt: expiresAt };
}

export async function logout(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  const hash = sha256(refreshToken);
  await Session.updateOne({ $or: [{ currentHash: hash }, { previousHash: hash }] }, { $set: { revokedAt: new Date() } });
}

/** Ends every session and invalidates outstanding access tokens for a user. */
export async function revokeAllSessions(userId: string): Promise<void> {
  const now = new Date();
  await Promise.all([
    Session.updateMany({ userId, revokedAt: { $exists: false } }, { $set: { revokedAt: now } }),
    User.updateOne({ _id: userId }, { $set: { tokensValidAfter: now } }),
  ]);
}

export async function forgotPassword(email: string): Promise<void> {
  const user = await User.findOne({ email });
  if (!user || user.status !== 'active') return; // same response either way
  const token = randomToken();
  await PasswordResetToken.create({ userId: user._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60 * 1000) });
  // The token travels in the URL fragment, which browsers never send to servers or put in access logs.
  const link = `${env.APP_ORIGIN}/reset-password#token=${token}`;
  await sendMail({
    to: user.email,
    subject: 'Reset your password',
    text: `Hi ${user.name},\n\nUse this link within 30 minutes to choose a new password:\n${link}\n\nIf you did not ask for this, ignore this email.`,
  });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const record = await PasswordResetToken.findOneAndUpdate(
    { tokenHash: sha256(token), usedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
  );
  if (!record) throw new AppError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or has expired.');
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  await User.updateOne({ _id: record.userId }, { $set: { passwordHash, passwordChangedAt: new Date() } });
  await revokeAllSessions(record.userId.toString());
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string, meta: ClientMeta) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw unauthorized();
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Current password is incorrect.', [
      { path: 'currentPassword', message: 'Current password is incorrect.' },
    ]);
  }
  user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  user.passwordChangedAt = new Date();
  await user.save();
  await revokeAllSessions(userId);
  // Keep the caller signed in with a fresh session.
  return createSession(user, meta);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_COST);
}
