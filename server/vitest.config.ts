import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/globalSetup.ts'],
    setupFiles: ['./test/setup.ts'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DEMO_MODE: 'true',
      UPLOAD_DIR: path.join(os.tmpdir(), 'storefront-test-uploads'),
    },
    testTimeout: 30_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    pool: 'forks',
  },
});
