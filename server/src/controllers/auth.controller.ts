import type { Request, Response } from 'express';
import {
  addressSchema,
  addressUpdateSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  objectId,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from '@shop/shared';
import { z } from 'zod';
import { isProd } from '../config/env';
import { auth } from '../middleware/auth';
import { handle } from '../middleware/handle';
import * as account from '../services/account.service';
import * as authService from '../services/auth.service';

const COOKIE = 'rt';
const COOKIE_PATH = '/api/v1/auth';

function meta(req: Request) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

function respondWithSession(res: Response, tokens: authService.SessionTokens, status = 200) {
  if (tokens.refreshToken && tokens.refreshExpiresAt) {
    res.cookie(COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      path: COOKIE_PATH,
      expires: tokens.refreshExpiresAt,
    });
  }
  res.status(status).json({ data: { user: tokens.user, accessToken: tokens.accessToken } });
}

const idParams = z.object({ id: objectId });

export const register = handle({ body: registerSchema }, async ({ req, res, body }) => {
  respondWithSession(res, await authService.register(body, meta(req)), 201);
});

export const login = handle({ body: loginSchema }, async ({ req, res, body }) => {
  respondWithSession(res, await authService.login(body, meta(req)));
});

export const refresh = handle({}, async ({ req, res }) => {
  // No cookie means "no session to restore", which is normal for visitors: not an error.
  if (!req.cookies?.[COOKIE]) {
    res.status(204).end();
    return;
  }
  try {
    respondWithSession(res, await authService.refresh(req.cookies?.[COOKIE]));
  } catch (err) {
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
    throw err;
  }
});

export const logout = handle({}, async ({ req, res }) => {
  await authService.logout(req.cookies?.[COOKIE]);
  res.clearCookie(COOKIE, { path: COOKIE_PATH });
  res.status(204).end();
});

export const forgotPassword = handle({ body: forgotPasswordSchema }, async ({ res, body }) => {
  await authService.forgotPassword(body.email);
  res.status(202).json({ data: { ok: true } });
});

export const resetPassword = handle({ body: resetPasswordSchema }, async ({ body }) => {
  await authService.resetPassword(body.token, body.password);
});

export const me = handle({}, async ({ req }) => authService.toPublicUser(auth(req).user));

export const updateMe = handle({ body: updateProfileSchema }, async ({ req, body }) => account.updateProfile(auth(req).userId, body));

export const changePassword = handle({ body: changePasswordSchema }, async ({ req, res, body }) => {
  const tokens = await authService.changePassword(auth(req).userId, body.currentPassword, body.newPassword, meta(req));
  res.cookie(COOKIE, tokens.refreshToken!, { httpOnly: true, secure: isProd, sameSite: 'strict', path: COOKIE_PATH, expires: tokens.refreshExpiresAt });
  res.json({ data: { user: tokens.user, accessToken: tokens.accessToken } });
});

export const listAddresses = handle({}, async ({ req }) => account.listAddresses(auth(req).userId));
export const createAddress = handle({ body: addressSchema }, async ({ req, body }) => account.createAddress(auth(req).userId, body), { status: 201 });
export const updateAddress = handle({ body: addressUpdateSchema, params: idParams }, async ({ req, body, params }) =>
  account.updateAddress(auth(req).userId, params.id, body),
);
export const deleteAddress = handle({ params: idParams }, async ({ req, params }) => {
  await account.deleteAddress(auth(req).userId, params.id);
});
export const setDefaultAddress = handle({ params: idParams }, async ({ req, params }) => account.setDefaultAddress(auth(req).userId, params.id));
