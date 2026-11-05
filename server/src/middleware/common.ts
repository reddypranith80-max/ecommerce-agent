import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { env, isTest } from '../config/env';
import { logger } from '../config/logger';
import { AppError, forbidden } from '../utils/errors';

// ---------------------------------------------------------------- rate limiting

function limiter(opts: { windowMs: number; limit: number; key?: (req: Request) => string; name: string }): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => isTest,
    keyGenerator: opts.key ? (req) => `${opts.name}:${opts.key!(req)}` : (req) => `${opts.name}:${req.ip}`,
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many attempts. Please wait a little and try again.')),
  });
}

const emailKey = (req: Request) => String((req.body as { email?: unknown } | undefined)?.email ?? '').trim().toLowerCase().slice(0, 254);
const userKey = (req: Request) => req.auth?.userId ?? req.ip ?? 'unknown';
const MIN = 60_000;

export const limits = {
  loginIp: limiter({ name: 'login-ip', windowMs: 15 * MIN, limit: 100 }),
  loginEmail: limiter({ name: 'login-email', windowMs: 15 * MIN, limit: 10, key: emailKey }),
  register: limiter({ name: 'register', windowMs: 60 * MIN, limit: 10 }),
  forgotIp: limiter({ name: 'forgot-ip', windowMs: 60 * MIN, limit: 10 }),
  forgotEmail: limiter({ name: 'forgot-email', windowMs: 60 * MIN, limit: 3, key: emailKey }),
  reset: limiter({ name: 'reset', windowMs: 60 * MIN, limit: 20 }),
  placeOrder: limiter({ name: 'orders', windowMs: 60 * MIN, limit: 10, key: userKey }),
  payment: limiter({ name: 'payment', windowMs: 60 * MIN, limit: 30, key: userKey }),
  reviews: limiter({ name: 'reviews', windowMs: 24 * 60 * MIN, limit: 20, key: userKey }),
  search: limiter({ name: 'search', windowMs: MIN, limit: 120 }),
  gateway: limiter({ name: 'gateway', windowMs: MIN, limit: 60 }),
  general: limiter({ name: 'general', windowMs: MIN, limit: 600 }),
};

// ---------------------------------------------------------------- CSRF guard for cookie-authenticated endpoints

/** The refresh cookie is SameSite=Strict; this adds a custom-header + Origin check as defence in depth. */
export const requireSameOrigin: RequestHandler = (req, _res, next) => {
  if (req.headers['x-requested-with'] !== 'fetch') throw forbidden('Missing request header.', 'CSRF_REJECTED');
  const origin = req.headers.origin;
  if (origin) {
    let ok = origin === env.APP_ORIGIN;
    try {
      ok ||= new URL(origin).host === req.headers.host;
    } catch {
      ok = false;
    }
    if (!ok) throw forbidden('Cross-origin request rejected.', 'CSRF_REJECTED');
  }
  next();
};

// ---------------------------------------------------------------- uploads

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) cb(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only image files can be uploaded.'));
    else cb(null, true);
  },
}).array('files', 10);

// ---------------------------------------------------------------- errors

export const notFoundHandler: RequestHandler = () => {
  throw new AppError(404, 'NOT_FOUND', 'This endpoint does not exist.');
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = String(req.id ?? '');
  const send = (status: number, code: string, message: string, details?: unknown) =>
    res.status(status).json({ error: { code, message, ...(details !== undefined ? { details } : {}), requestId } });

  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err, requestId }, err.message);
    return send(err.status, err.code, err.message, err.details);
  }
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return send(413, 'PAYLOAD_TOO_LARGE', 'Each image must be 5 MB or smaller.');
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return send(400, 'VALIDATION_ERROR', 'Upload up to 10 images at a time.');
    return send(400, 'VALIDATION_ERROR', err.message);
  }
  const e = err as { type?: string; name?: string; code?: number; status?: number };
  if (e.type === 'entity.too.large') return send(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.');
  if (e.type === 'entity.parse.failed') return send(400, 'VALIDATION_ERROR', 'Request body is not valid JSON.');
  if (e.name === 'CastError') return send(400, 'VALIDATION_ERROR', 'Invalid identifier.');
  if (e.name === 'VersionError') return send(409, 'STALE_VERSION', 'This record was changed by someone else. Reload and try again.');
  if (e.code === 11000) return send(409, 'DUPLICATE', 'That value is already in use.');

  logger.error({ err, requestId }, 'Unhandled error');
  return send(500, 'INTERNAL_ERROR', 'Something went wrong on our side. Please try again.');
};
