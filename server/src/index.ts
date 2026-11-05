import mongoose from 'mongoose';
import { applyCollectionValidators, connectDb } from './config/db';
import { env } from './config/env';
import { logger } from './config/logger';
import { createApp } from './app';
import { startJobs } from './jobs';
import { Product } from './models/catalog.model';
import { seedDatabase } from './scripts/seedData';

async function main() {
  await connectDb(env.MONGODB_URI);
  await applyCollectionValidators();
  await mongoose.connection.syncIndexes();
  logger.info('Indexes and validators are in place');

  if (env.AUTO_SEED && (await Product.estimatedDocumentCount()) === 0) {
    logger.info('Empty database: loading demo data (first run only)…');
    await seedDatabase();
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}`);
  });
  const stopJobs = env.RUN_JOBS ? startJobs() : () => {};

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    stopJobs();
    const timer = setTimeout(() => process.exit(1), 10_000);
    timer.unref();
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
