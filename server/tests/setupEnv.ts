import { inject } from 'vitest';

// Runs before each test file is imported, so the Prisma client connects to the
// in-memory database started by globalSetup.ts.
process.env.DATABASE_URL = inject('databaseUrl');
