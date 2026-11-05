import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const SERVER_ROOT = path.resolve(import.meta.dirname, '../..');
export const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

const envFile = path.join(SERVER_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const DEV_DEFAULTS = {
  JWT_SECRET: 'dev-only-jwt-secret-change-me-0123456789abcdef',
  DEMOPAY_KEY_SECRET: 'dev-only-demopay-key-secret-0123456789',
  DEMOPAY_WEBHOOK_SECRET: 'dev-only-demopay-webhook-secret-0123456789',
};

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    MONGODB_URI: z.string().default('mongodb://127.0.0.1:27027/storefront?replicaSet=rs0'),
    APP_ORIGIN: z.string().url().default('http://localhost:5173'),
    JWT_SECRET: z.string().min(32).default(DEV_DEFAULTS.JWT_SECRET),
    DEMOPAY_KEY_ID: z.string().default('demopay_test_key'),
    DEMOPAY_KEY_SECRET: z.string().min(16).default(DEV_DEFAULTS.DEMOPAY_KEY_SECRET),
    DEMOPAY_WEBHOOK_SECRET: z.string().min(16).default(DEV_DEFAULTS.DEMOPAY_WEBHOOK_SECRET),
    DEMOPAY_WEBHOOK_URL: z.string().url().optional(),
    DEMO_MODE: bool.default(true),
    AUTO_SEED: bool.default(true),
    RUN_JOBS: bool.default(true),
    UPLOAD_DIR: z.string().default(path.join(REPO_ROOT, '.data', 'uploads')),
    SERVE_CLIENT: bool.default(false),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const [key, value] of Object.entries(DEV_DEFAULTS)) {
      if (env[key as keyof typeof DEV_DEFAULTS] === value) {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} must be set in production.` });
      }
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
