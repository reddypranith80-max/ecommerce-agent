/**
 * npm run seed            → loads demo data if the database is empty
 * npm run seed -- --reset → wipes the store database and uploaded images, then loads fresh demo data
 */
import { rm } from 'node:fs/promises';
import mongoose from 'mongoose';
import { applyCollectionValidators, connectDb } from '../config/db';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { Product } from '../models/catalog.model';
import '../integrations/demopay/gateway.model';
import '../models/order.model';
import '../models/shopping.model';
import '../models/system.model';
import '../models/user.model';
import { DEMO_ACCOUNTS, seedDatabase } from './seedData';

async function main() {
  const reset = process.argv.includes('--reset');
  await connectDb(env.MONGODB_URI);
  if (reset) {
    logger.warn('Resetting the database and uploads');
    await mongoose.connection.dropDatabase();
    await rm(env.UPLOAD_DIR, { recursive: true, force: true });
  }
  await applyCollectionValidators();
  await mongoose.connection.syncIndexes();
  if ((await Product.estimatedDocumentCount()) > 0) {
    logger.info('Database already has products; nothing to do (use --reset to start over).');
  } else {
    await seedDatabase();
  }
  logger.info(`Admin: ${DEMO_ACCOUNTS.admin.email} / ${DEMO_ACCOUNTS.admin.password}`);
  logger.info(`Customer: ${DEMO_ACCOUNTS.customer.email} / ${DEMO_ACCOUNTS.customer.password}`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  logger.fatal({ err }, 'Seed failed');
  await mongoose.disconnect();
  process.exit(1);
});
