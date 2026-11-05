/**
 * Starts a local single-node MongoDB replica set for development, with no installation needed.
 * The mongod binary is downloaded once by mongodb-memory-server and cached in node_modules.
 * Data persists in <repo>/.data/db. Transactions work because it is a replica set.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MongoBinary } from 'mongodb-memory-server';
import mongoose from 'mongoose';

const PORT = Number(process.env.LOCAL_DB_PORT ?? 27027);
const dataDir = path.resolve(import.meta.dirname, '../../.data');
const dbPath = path.join(dataDir, 'db');
const directUri = `mongodb://127.0.0.1:${PORT}/?directConnection=true`;

async function tryConnect(timeoutMs: number) {
  try {
    const client = new mongoose.mongo.MongoClient(directUri, { serverSelectionTimeoutMS: timeoutMs });
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

async function ensureReplicaSet(client: mongoose.mongo.MongoClient) {
  const admin = client.db('admin');
  try {
    await admin.command({ replSetGetStatus: 1 });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code !== 94) throw err; // 94 = NotYetInitialized
    await admin.command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: `127.0.0.1:${PORT}` }] } });
  }
  for (let i = 0; i < 60; i++) {
    const hello = await admin.command({ hello: 1 });
    if (hello.isWritablePrimary) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Replica set did not become primary in time.');
}

async function main() {
  let child: ChildProcess | null = null;
  let client = await tryConnect(1000);

  if (client) {
    console.log(`[db] Reusing MongoDB already running on port ${PORT}.`);
  } else {
    mkdirSync(dbPath, { recursive: true });
    console.log('[db] Locating MongoDB binary (first run downloads it automatically)…');
    const binary = await MongoBinary.getPath();
    child = spawn(
      binary,
      ['--port', String(PORT), '--bind_ip', '127.0.0.1', '--replSet', 'rs0', '--dbpath', dbPath,
        '--logpath', path.join(dataDir, 'mongod.log'), '--logappend'],
      { stdio: 'ignore' },
    );
    child.on('exit', (code) => {
      console.log(`[db] mongod exited with code ${code}. See .data/mongod.log`);
      process.exit(code ?? 1);
    });
    for (let i = 0; i < 60 && !client; i++) client = await tryConnect(1000);
    if (!client) throw new Error('mongod did not start. See .data/mongod.log');
  }

  await ensureReplicaSet(client);
  console.log(`[db] MongoDB replica set ready at mongodb://127.0.0.1:${PORT}/?replicaSet=rs0`);

  const shutdown = async () => {
    if (child) {
      console.log('[db] Shutting down MongoDB…');
      try {
        await client!.db('admin').command({ shutdown: 1 });
      } catch {
        /* the connection drops as mongod exits */
      }
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Keep the process alive while mongod runs.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error('[db] Failed to start MongoDB:', err);
  process.exit(1);
});
