/**
 * Runs MongoDB locally for development - no installation or admin rights needed.
 *
 *   npm run db:local
 *
 * The first run downloads the MongoDB server binary (~100 MB, cached in your
 * user folder). Data is stored in server/.mongo-data and kept between runs.
 * MongoDB runs as a single-node replica set named "rs0", which Prisma needs
 * for transactions. Keep this terminal open while you use the app.
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const PORT = Number(process.env.MONGO_PORT ?? 27017);
const dbPath = fileURLToPath(new URL('../.mongo-data', import.meta.url));
mkdirSync(dbPath, { recursive: true });

const replSet = await MongoMemoryReplSet.create({
  replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
  instanceOpts: [{ port: PORT, dbPath }],
});

console.log('');
console.log(`MongoDB is running on port ${PORT} (data: ${dbPath})`);
console.log(`DATABASE_URL=mongodb://127.0.0.1:${PORT}/drive_clone?replicaSet=rs0`);
console.log('Press Ctrl+C to stop.');

async function shutdown() {
  // doCleanup: false keeps the data folder for next time.
  await replSet.stop({ doCleanup: false, force: false });
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
