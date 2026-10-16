import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // globalSetup starts an in-memory MongoDB; setupEnv points Prisma at it.
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setupEnv.ts'],
    fileParallelism: false, // test files share one database, so run them one at a time
    testTimeout: 30_000,
    hookTimeout: 120_000, // the first run downloads the MongoDB binary
    env: {
      NODE_ENV: 'test',
      WEB_ORIGIN: 'http://localhost:3000',
      // Small limits make the upload-validation tests fast.
      MAX_UPLOAD_MB: '1',
      STORAGE_QUOTA_MB: '3',
      // ~104-byte pieces so small test files are split into several pieces.
      UPLOAD_CHUNK_MB: '0.0001',
      // Most tests use an in-memory storage driver; localStorage.test.ts uses this temp folder.
      STORAGE_DRIVER: 'local',
      LOCAL_STORAGE_DIR: join(tmpdir(), `drive-clone-test-storage-${process.pid}`),
      R2_ACCOUNT_ID: 'test',
      R2_ACCESS_KEY_ID: 'test',
      R2_SECRET_ACCESS_KEY: 'test',
      R2_BUCKET: 'test',
    },
  },
});
