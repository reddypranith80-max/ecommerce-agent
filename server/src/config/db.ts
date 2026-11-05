import mongoose, { type ClientSession } from 'mongoose';
import { logger } from './logger';

mongoose.set('strictQuery', true);
mongoose.set('transactionAsyncLocalStorage', true);

export async function connectDb(uri: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
      logger.info('Connected to MongoDB');
      return;
    } catch (err) {
      if (attempt >= 30) throw err;
      logger.warn({ attempt }, 'MongoDB not reachable yet, retrying in 2s');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

/**
 * Runs fn inside a multi-document transaction. The driver retries on transient errors,
 * so fn must not perform external side effects (HTTP calls, emails).
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}

/** Collection-level guard: inventory counters can never go negative, even if code has a bug. */
export async function applyCollectionValidators(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database not connected');
  const validator = {
    $jsonSchema: {
      bsonType: 'object',
      required: ['sku', 'available', 'reserved', 'allocated'],
      properties: {
        available: { bsonType: ['int', 'long', 'double'], minimum: 0 },
        reserved: { bsonType: ['int', 'long', 'double'], minimum: 0 },
        allocated: { bsonType: ['int', 'long', 'double'], minimum: 0 },
      },
    },
  };
  const existing = await db.listCollections({ name: 'inventories' }).toArray();
  if (existing.length === 0) {
    try {
      await db.createCollection('inventories', { validator, validationLevel: 'strict', validationAction: 'error' });
      return;
    } catch (err) {
      // Mongoose's autoCreate may have created it concurrently; fall through and apply the validator.
      if ((err as { code?: number }).code !== 48) throw err;
    }
  }
  await db.command({ collMod: 'inventories', validator, validationLevel: 'strict', validationAction: 'error' });
}

export function isDuplicateKeyError(err: unknown, field?: string): boolean {
  const e = err as { code?: number; keyPattern?: Record<string, unknown> };
  if (e?.code !== 11000) return false;
  return field ? Boolean(e.keyPattern && field in e.keyPattern) : true;
}
