import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env, REPO_ROOT } from './config/env';
import { logger } from './config/logger';
import { demopayWebhook } from './controllers/gateway.controller';
import { errorHandler, limits, notFoundHandler } from './middleware/common';
import { apiRouter } from './routes';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url?.startsWith('/uploads/') ?? false },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      serializers: { req: (req) => ({ method: req.method, url: req.url }), res: (res) => ({ statusCode: res.statusCode }) },
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );

  // Webhooks need the exact raw bytes to verify the signature, so this route is registered before express.json().
  app.post('/api/v1/webhooks/demopay', express.raw({ type: 'application/json', limit: '256kb' }), demopayWebhook);

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.use('/uploads', express.static(env.UPLOAD_DIR, { maxAge: '30d', immutable: true, index: false, fallthrough: false }));
  app.use('/api/v1', limits.general, apiRouter());
  app.use('/api', notFoundHandler);

  if (env.SERVE_CLIENT) {
    const dist = path.join(REPO_ROOT, 'client', 'dist');
    if (existsSync(dist)) {
      app.use(express.static(dist, { index: false, maxAge: '1h' }));
      app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    } else {
      logger.warn('SERVE_CLIENT is on but client/dist does not exist. Run "npm run build" first.');
    }
  }

  app.use(errorHandler);
  return app;
}
