import { execSync } from 'node:child_process';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

let replSet: MongoMemoryReplSet | undefined;

/**
 * Runs once before all tests: starts a throwaway in-memory MongoDB replica set
 * (no installation needed), creates the indexes, and hands its URL to the tests.
 */
export async function setup(project: TestProject) {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const databaseUrl = replSet.getUri('drive_clone_test');

  execSync('npx prisma db push --skip-generate', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  project.provide('databaseUrl', databaseUrl);
}

export async function teardown() {
  await replSet?.stop();
}
